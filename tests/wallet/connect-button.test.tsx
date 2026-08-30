// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * DOM tests for the hardened wallet sign-in (Enoki/Google seedless) flow.
 *
 * Only the dapp-kit/enoki hooks and the dynamic ConnectModal are mocked. The
 * real sign-in state model (`@/components/wallet/sign-in-state`) is exercised.
 *
 * These tests pin:
 *  - honest fallback when no Google wallet is registered (the runtime signal,
 *    not a re-derived env check — providers.tsx owns the env gate);
 *  - customer-readable popup cancel/config/failure/retry states;
 *  - no jargon on the primary sign-in surface, no leaked error/secret text;
 *  - idempotent connect: a second click or close/reopen while a Google
 *    connect is in flight never starts a second OAuth call — the reopened
 *    dialog shows Connecting for the same attempt;
 *  - success publishes the connected account before the promise resolves;
 *  - stale error isolation: closing an error dialog resets to idle so a
 *    reopened dialog is clean;
 *  - authentication never touches transaction signing or execution.
 *
 * The component does NOT read NEXT_PUBLIC_ENOKI_API_KEY /
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID (the provider owns that gate), so no env
 * fixtures are stubbed here — stubbing secret-looking env values the
 * component never reads would be misleading dead fixtures.
 */

const ADDR = "0x" + "ab".repeat(32);

// Reactive wallet connection store mirroring real dAppKit: connectWallet
// synchronously flips isConnecting to true and back to false when the
// promise settles, and useWalletConnection subscribes via
// useSyncExternalStore so those flips rerender the component. The previous
// static mock returned a mutable object and never rerendered on its own,
// so it could not expose the production race where the early-return
// unmounts the sign-in dialog mid-connect.
const { walletStore, dappkit, connectWalletImpl, googleWallet, walletsRef } =
  vi.hoisted(() => {
    type WalletState = {
      account: { address: string } | null;
      isConnecting: boolean;
      isReconnecting: boolean;
    };
    const listeners = new Set<() => void>();
    let state: WalletState = {
      account: null,
      isConnecting: false,
      isReconnecting: false,
    };
    const walletStore = {
      subscribe(cb: () => void) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      getSnapshot() {
        return state;
      },
      set(partial: Partial<WalletState>) {
        state = { ...state, ...partial };
        listeners.forEach((l) => l());
      },
      reset() {
        state = { account: null, isConnecting: false, isReconnecting: false };
        listeners.clear();
      },
    };
    // Tests configure per-call resolve/reject behavior on this inner mock;
    // the outer dappkit.connectWallet wrapper owns the reactive isConnecting
    // transition so it can never be bypassed by a mockReturnValueOnce.
    const connectWalletImpl = vi.fn();
    // Real dAppKit publishes the connected account to its wallet store BEFORE
    // the connectWallet promise resolves (the store subscription fires first,
    // then the awaiter resumes). Mirroring that here is what makes the
    // success path honest: the dialog disappears because connection.account
    // becomes non-null, not because the component flips a local flag.
    const publishAccount = (value: unknown) => {
      const accounts = (value as { accounts?: { address: string }[] })?.accounts;
      const first = accounts?.[0];
      if (first) {
        walletStore.set({ account: { address: first.address } });
      }
    };
    // Real dAppKit (dapp-kit-core connectWalletCreator) does direct per-call
    // status mutation: each call sets status to "connecting" synchronously,
    // then sets "connected" (publishing the account) on success or
    // "disconnected" on error. There is NO ref-counting of in-flight calls.
    const dappkit = {
      connectWallet: vi.fn((...args: unknown[]) => {
        walletStore.set({ isConnecting: true });
        const result = connectWalletImpl(...args);
        Promise.resolve(result).then(
          (value) => {
            publishAccount(value);
            walletStore.set({ isConnecting: false });
          },
          () => walletStore.set({ isConnecting: false }),
        );
        return result;
      }),
      disconnectWallet: vi.fn(),
      signTransaction: vi.fn(),
      signAndExecuteTransaction: vi.fn(),
      signPersonalMessage: vi.fn(),
      stores: {
        $wallets: { get: () => [] as unknown[] },
      },
    };
    // A wallet object identified by metadata features, never by display name.
    const googleWallet = {
      "data-enoki-google": true,
      icon: "data:image/svg+xml,stub",
    };
    const walletsRef = { current: [] as unknown[] };
    return { walletStore, dappkit, connectWalletImpl, googleWallet, walletsRef };
  });

vi.mock("@mysten/dapp-kit-react", () => ({
  useDAppKit: () => dappkit,
  useWalletConnection: () =>
    React.useSyncExternalStore(walletStore.subscribe, walletStore.getSnapshot),
  useWallets: () => walletsRef.current,
}));

vi.mock("@mysten/enoki", () => ({
  isEnokiWallet: (w: unknown) => Boolean((w as Record<string, boolean>)?.["data-enoki-google"]),
  isGoogleWallet: (w: unknown) => Boolean((w as Record<string, boolean>)?.["data-enoki-google"]),
}));

vi.mock("@mysten/dapp-kit-react/ui", () => ({
  ConnectModal: (props: { open?: boolean }) =>
    props.open ? React.createElement("div", { "data-testid": "connect-modal" }) : null,
}));

// next/dynamic wraps the ConnectModal with ssr:false; in tests resolve it
// synchronously so the stub renders immediately when `open` is true.
vi.mock("next/dynamic", () => ({
  default: () => (props: { open?: boolean }) =>
    props.open ? React.createElement("div", { "data-testid": "connect-modal" }) : null,
}));

import { WalletConnectButton } from "@/components/wallet/connect-button";

beforeEach(() => {
  walletStore.reset();
  // mockClear (not mockReset) on the wrapper: its reactive implementation is
  // permanent and must not be stripped. Only call history is cleared.
  dappkit.connectWallet.mockClear();
  connectWalletImpl.mockReset();
  dappkit.disconnectWallet.mockReset();
  dappkit.signTransaction.mockReset();
  dappkit.signAndExecuteTransaction.mockReset();
  dappkit.signPersonalMessage.mockReset();
  walletsRef.current = [];
});

afterEach(() => {
  cleanup();
});

/** Configure whether the Enoki Google wallet is registered/available. */
function setGoogleAvailable(available: boolean) {
  walletsRef.current = available ? [googleWallet] : [];
}

/** Open the sign-in dialog from the nav chip. */
function openSignIn() {
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

/** Close the dialog via its accessible Close button (triggers onOpenChange(false)). */
function closeSignInDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
}

/** Assert no signing/execution method on the dAppKit surface was ever called. */
function expectNoSigningOrExecution() {
  expect(dappkit.signTransaction).not.toHaveBeenCalled();
  expect(dappkit.signAndExecuteTransaction).not.toHaveBeenCalled();
  expect(dappkit.signPersonalMessage).not.toHaveBeenCalled();
}

describe("WalletConnectButton — sign-in surface when Google wallet is registered", () => {
  it("shows a 'Sign in with Google' primary action and a wallet-extension fallback", () => {
    setGoogleAvailable(true);
    render(<WalletConnectButton />);
    openSignIn();

    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Use a wallet extension/i }),
    ).toBeInTheDocument();
  });

  it("does not leak implementation jargon onto the primary sign-in surface", () => {
    setGoogleAvailable(true);
    const { container } = render(<WalletConnectButton />);
    openSignIn();

    const text = container.textContent?.toLowerCase() ?? "";
    for (const term of ["enoki", "zklogin", "oauth", "jwt", "token", "salt", "api", "dapp-kit"]) {
      expect(text).not.toContain(term);
    }
  });
});

describe("WalletConnectButton — honest fallback when no Google wallet is registered", () => {
  it("does not render a 'Sign in with Google' button when Google is unavailable", () => {
    setGoogleAvailable(false);
    render(<WalletConnectButton />);
    openSignIn();

    expect(screen.queryByRole("button", { name: /Sign in with Google/i })).toBeNull();
  });

  it("offers an extension-wallet connect path instead of faking Google auth", () => {
    setGoogleAvailable(false);
    render(<WalletConnectButton />);
    openSignIn();

    const fallback = screen.getByRole("button", { name: /Connect a wallet/i });
    fireEvent.click(fallback);
    expect(screen.getByTestId("connect-modal")).toBeInTheDocument();
  });
});

describe("WalletConnectButton — popup blocked state", () => {
  it("shows a readable 'pop-up blocked' message and a retry when the popup is blocked", async () => {
    setGoogleAvailable(true);
    connectWalletImpl.mockRejectedValueOnce(new Error("Failed to open popup"));
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pop-up blocked/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — popup cancelled state", () => {
  it("shows a readable 'cancelled' message and a retry when the user closes the popup", async () => {
    setGoogleAvailable(true);
    connectWalletImpl.mockRejectedValueOnce(new Error("Popup closed"));
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));

    await waitFor(() => {
      expect(screen.getByText(/Sign-in cancelled/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — generic failure state", () => {
  it("shows a generic 'couldn't sign in' message and does not echo the raw error", async () => {
    setGoogleAvailable(true);
    connectWalletImpl.mockRejectedValueOnce(new Error("jwt expired Bearer_SECRET"));
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn’t sign in/i)).toBeInTheDocument();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toContain("Bearer_SECRET");
    expect(dialog.textContent).not.toContain("jwt expired");
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — retry re-attempts the Google connect", () => {
  it("retries the connect when 'Try again' is clicked", async () => {
    setGoogleAvailable(true);
    connectWalletImpl.mockRejectedValueOnce(new Error("Popup closed"));
    connectWalletImpl.mockResolvedValueOnce({ accounts: [{ address: ADDR }] });
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByText(/Sign-in cancelled/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    await waitFor(() => {
      expect(dappkit.connectWallet).toHaveBeenCalledTimes(2);
    });
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — connecting state", () => {
  it("shows a 'Connecting' state and disables the Google action while in flight", async () => {
    setGoogleAvailable(true);
    let resolveConnect!: (value: { accounts: { address: string }[] }) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByText(/Connecting/i)).toBeInTheDocument();
    });

    // The Google action must not be clickable again mid-flight.
    expect(screen.queryByRole("button", { name: /^Sign in with Google$/i })).toBeNull();

    resolveConnect({ accounts: [{ address: ADDR }] });
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — locally initiated connect survives the real isConnecting transition", () => {
  // Real dAppKit's connectWallet synchronously flips
  // useWalletConnection().isConnecting to true the moment it is called. The
  // component must keep the sign-in dialog mounted through that transition so
  // the user sees the in-dialog "Connecting…" state — not the compact nav
  // trigger that the early-return renders for an EXTERNAL connecting state.
  it("keeps the dialog mounted with in-dialog Connecting UI when connectWallet flips isConnecting synchronously", async () => {
    setGoogleAvailable(true);
    let resolveConnect!: (value: { accounts: { address: string }[] }) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));

    // The dialog must remain mounted (not unmounted by the early-return)
    // and carry the Connecting UI inside it.
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveTextContent(/Connecting/i);
    });

    // The compact nav "Connecting…" trigger (the early-return branch) must
    // NOT be the surface shown — it is reserved for external/reconnecting
    // state. It is a disabled button whose accessible name starts with
    // "Connecting", distinct from the in-dialog Connecting region.
    expect(
      screen.queryByRole("button", { name: /^Connecting/i }),
    ).toBeNull();

    resolveConnect({ accounts: [{ address: ADDR }] });
    expectNoSigningOrExecution();
  });

  it("an external connecting state (no local attempt) still uses the compact trigger, not the dialog", () => {
    // Simulate a reconnect or another wallet's connect that this component
    // did not initiate: isConnecting true with no local attempt in flight.
    // The compact "Connecting…" trigger is the correct surface here.
    walletStore.set({ isConnecting: true });
    setGoogleAvailable(true);
    render(<WalletConnectButton />);

    const trigger = screen.getByRole("button", { name: /^Connecting/i });
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — idempotent connect: close/reopen does not start a second call", () => {
  it("closing and reopening while a Google connect is in flight shows Connecting and does not expose a second Google action or call", async () => {
    setGoogleAvailable(true);
    let resolveConnect!: (value: { accounts: { address: string }[] }) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    });
    expect(dappkit.connectWallet).toHaveBeenCalledTimes(1);

    // Close while the connect is still in flight. The attempt stays alive —
    // the dialog closes but the in-flight connect is NOT invalidated.
    closeSignInDialog();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Reopen: the dialog must show Connecting for the SAME attempt, not a
    // fresh Google action. No second connectWallet call may be made.
    openSignIn();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    // No Google action or Try again is exposed while the attempt is in flight.
    expect(screen.queryByRole("button", { name: /Sign in with Google/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/i })).toBeNull();
    // The compact nav "Connecting…" trigger must never be the surface here.
    expect(screen.queryByRole("button", { name: /^Connecting/i })).toBeNull();
    expect(dappkit.connectWallet).toHaveBeenCalledTimes(1);

    resolveConnect({ accounts: [{ address: ADDR }] });
    expectNoSigningOrExecution();
  });

  it("a late rejection after close/reopen shows the error on the reopened dialog (the attempt is still alive)", async () => {
    setGoogleAvailable(true);
    let rejectConnect!: (error: Error) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectConnect = reject;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    });

    closeSignInDialog();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    openSignIn();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    });

    // The in-flight attempt rejects. The reopened dialog must show the error
    // honestly — the attempt was never invalidated by the close.
    rejectConnect(new Error("Popup closed"));
    await waitFor(() => {
      expect(screen.getByText(/Sign-in cancelled/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(dappkit.connectWallet).toHaveBeenCalledTimes(1);
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — success publishes the connected account before the connect promise resolves", () => {
  it("the dialog is dismissed by the connected account, not by a local flag flip", async () => {
    setGoogleAvailable(true);
    let resolveConnect!: (value: { accounts: { address: string }[] }) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    });

    // Real dAppKit publishes the connected account to its store BEFORE the
    // connectWallet promise resolves. The mock mirrors this: the store
    // subscription fires first, then the awaiter resumes. The honest outcome
    // is that the sign-in surface is replaced by the connected-wallet chip
    // because connection.account became non-null — not because the component
    // flipped a local dialog-open flag.
    resolveConnect({ accounts: [{ address: ADDR }] });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Sign in with Google/i })).toBeNull();
    // The compact nav "Connecting…" trigger must never be the surface here.
    expect(screen.queryByRole("button", { name: /^Connecting/i })).toBeNull();
    expect(screen.getByRole("button", { name: `Wallet ${ADDR}` })).toBeInTheDocument();
    expectNoSigningOrExecution();
  });

  it("a late resolution after the dialog was closed connects the wallet via the published account", async () => {
    setGoogleAvailable(true);
    let resolveConnect!: (value: { accounts: { address: string }[] }) => void;
    connectWalletImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(/Connecting/i);
    });

    closeSignInDialog();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // The in-flight attempt resolves while the dialog is closed. Real dAppKit
    // publishes the account to its store, so the honest outcome is that the
    // wallet is now connected: the nav chip transitions to the connected
    // wallet. No dialog reappears.
    resolveConnect({ accounts: [{ address: ADDR }] });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Sign in with Google/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Connecting/i })).toBeNull();
    expect(screen.getByRole("button", { name: `Wallet ${ADDR}` })).toBeInTheDocument();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — stale error isolation: a closed error dialog reopens clean", () => {
  it("closing an error dialog resets to idle so a reopened dialog shows no error and no Try again", async () => {
    setGoogleAvailable(true);
    connectWalletImpl.mockRejectedValueOnce(new Error("Popup closed"));
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/i }));
    await waitFor(() => {
      expect(screen.getByText(/Sign-in cancelled/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();

    // Close the error dialog. The attempt is invalidated (id bump) and the
    // stage resets to idle so a reopened dialog is clean.
    closeSignInDialog();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    openSignIn();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
    expect(screen.queryByText(/Sign-in cancelled/i)).toBeNull();
    expect(screen.queryByText(/Pop-up blocked/i)).toBeNull();
    expect(screen.queryByText(/Couldn’t sign in/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/i })).toBeNull();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — connected account menu", () => {
  it("renders a truncated address chip when connected", () => {
    walletStore.set({ account: { address: ADDR } });
    render(<WalletConnectButton />);

    const chip = screen.getByRole("button", { name: `Wallet ${ADDR}` });
    expect(chip).toBeInTheDocument();
    // Truncated form 0xab…XXXX
    expect(chip.textContent).toContain("0xab");
  });

  it("disconnects through dAppKit and never touches transaction signing", async () => {
    walletStore.set({ account: { address: ADDR } });
    dappkit.disconnectWallet.mockResolvedValueOnce(undefined);
    render(<WalletConnectButton />);

    fireEvent.click(screen.getByRole("button", { name: `Wallet ${ADDR}` }));
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));

    await waitFor(() => {
      expect(dappkit.disconnectWallet).toHaveBeenCalledTimes(1);
    });
    // Authentication must remain separate from transaction approval.
    expect(dappkit.connectWallet).not.toHaveBeenCalled();
    expectNoSigningOrExecution();
  });
});

describe("WalletConnectButton — extension fallback when Google wallet is registered", () => {
  it("opens the generic ConnectModal from the secondary extension action", () => {
    setGoogleAvailable(true);
    render(<WalletConnectButton />);
    openSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Use a wallet extension/i }));
    expect(screen.getByTestId("connect-modal")).toBeInTheDocument();
    expectNoSigningOrExecution();
  });
});
