// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { CommerceChat } from "@/components/commerce/commerce-chat";
import { PurchasePreview } from "@/components/commerce/purchase-preview";
import { CheckoutDialog } from "@/components/commerce/checkout-dialog";
import type {
  PurchaseIntentPreview,
  PurchaseIntentClarification,
} from "@/lib/commerce/intent";

/**
 * Wave 2 Tasks 2.2 / 2.3 + Wave 3 integration — DOM tests for the chat-first
 * purchase surface.
 *
 * The chat submits free text to the typed `/api/commerce/intent` endpoint and
 * renders the typed response in a thread: an inline preview card for a
 * `preview` result, a clarification message for a `clarification` result, and
 * an error message with retry on a fetch failure. A preview card carries a
 * cancel/reopen confirm gate; confirm opens a two-step checkout dialog that
 * hosts the real `PaymentAction` settlement surface. The originating inline
 * preview flips to `confirmed` — hiding its Confirm/Cancel controls — only
 * after the dialog reports a terminal successful settlement (real testnet or
 * explicit DEMO); cancellation or payment failure never confirms. Voice input
 * is wired through `useVoiceInput`, mocked here so the chat's wiring (mic
 * toggle, listening state, interim transcript, final-text fill, unsupported
 * fallback) is exercised in isolation.
 *
 * Only `fetch`, the voice hook, the dapp-kit v2 hooks (so `PaymentAction` runs
 * in a deterministic DEMO mode without a wallet), and the radix Dialog
 * primitives (portals/focus traps are flaky in jsdom) are mocked. The chat,
 * preview, dialog, and the real `PaymentAction` + payment core run for real,
 * so the reachable-payment-receipt and no-double-fire paths are exercised
 * end-to-end.
 */

const GOLDEN = "Buy two iced coffees under 8 SUI from River Cafe";

const PREVIEW: PurchaseIntentPreview = {
  kind: "preview",
  action: "buy",
  item: { id: "iced-coffee", name: "Iced Coffee" },
  quantity: 2,
  unitPriceMist: "3000000000",
  totalMist: "6000000000",
  priceCeilingMist: "8000000000",
  merchant: {
    id: "river-cafe",
    name: "River Cafe",
    address: null,
  },
  confidence: 1,
  clarification: null,
};

const CLARIFICATION: PurchaseIntentClarification = {
  kind: "clarification",
  action: "buy",
  clarification: { code: "missing_quantity", reason: "Quantity is required." },
  item: null,
  quantity: null,
  merchant: null,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Hoisted holder so each test can drive the mocked voice hook's state.
const voice = vi.hoisted(() => ({
  supported: true,
  listening: false,
  interimTranscript: "",
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  onFinal: undefined as ((text: string) => void) | undefined,
}));

vi.mock("@/components/commerce/use-voice-input", () => ({
  useVoiceInput: (opts?: { onFinal?: (text: string) => void }) => {
    voice.onFinal = opts?.onFinal;
    return {
      supported: voice.supported,
      listening: voice.listening,
      interimTranscript: voice.interimTranscript,
      error: voice.error,
      start: voice.start,
      stop: voice.stop,
    };
  },
}));

// dapp-kit v2 hooks: stubbed so the real `PaymentAction` (rendered inside the
// checkout dialog's payment step) resolves to a deterministic DEMO mode with
// no connected wallet. The real payment core (`@/lib/commerce/payment`) and
// `Transaction` builder still run, so the DEMO receipt and mode gating are
// exercised for real. `signAndExecuteTransaction` is wired but never called in
// DEMO mode.
const wallet = vi.hoisted(() => ({
  account: null as { address: string } | null,
  network: "testnet" as string,
  signAndExecuteTransaction: vi.fn(),
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({
    signAndExecuteTransaction: wallet.signAndExecuteTransaction,
  }),
}));

// Inline Dialog primitives so portals/focus traps don't run in jsdom. The
// CheckoutDialog's own content and callback wiring still run for real.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogOverlay: () => <div data-testid="dialog-overlay" />,
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-content" role="dialog" aria-modal="true">
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

// Button: keep the real one, but ensure 44px hit targets are observable via a
// data attribute set by the components. The real Button is fine in jsdom.

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  voice.supported = true;
  voice.listening = false;
  voice.interimTranscript = "";
  voice.error = null;
  voice.start.mockReset();
  voice.stop.mockReset();
  voice.onFinal = undefined;
  // No connected wallet + no configured merchant => PaymentAction runs in
  // explicitly labelled DEMO mode (no on-chain settlement, no wallet call).
  wallet.account = null;
  wallet.network = "testnet";
  wallet.signAndExecuteTransaction.mockReset();
  vi.stubEnv("NEXT_PUBLIC_MERCHANT_ADDRESS", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

// ---------------------------------------------------------------------------
// CommerceChat — rendering and golden prompt
// ---------------------------------------------------------------------------

describe("CommerceChat — rendering", () => {
  it("renders the composer with a text input, a send button, and a mic button", () => {
    render(<CommerceChat networkMode="demo" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /microphone/i })).toBeInTheDocument();
  });

  it("shows the golden prompt as a visible hint", () => {
    render(<CommerceChat networkMode="demo" />);
    expect(screen.getByText(new RegExp(GOLDEN))).toBeInTheDocument();
  });

  it("disables the send button while the input is empty", () => {
    render(<CommerceChat networkMode="demo" />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — send, loading, preview
// ---------------------------------------------------------------------------

describe("CommerceChat — send and inline preview", () => {
  it("posts the typed text to /api/commerce/intent and renders an inline preview", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);

    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // Loading state appears while the fetch is in flight.
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/commerce/intent",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // The user's message and the assistant's preview both appear in the thread.
    // The golden prompt also shows as a hint in the header, so it appears at
    // least twice (hint + echoed user message).
    expect(screen.getAllByText(new RegExp(GOLDEN)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Iced Coffee")).toBeInTheDocument();
    // "River Cafe" appears in the echoed user message and the preview merchant.
    expect(screen.getAllByText(/River Cafe/).length).toBeGreaterThanOrEqual(2);
    // Total SUI is rendered (6_000_000_000 MIST = 6 SUI).
    expect(screen.getByText(/6(\.0+)?\s*SUI/i)).toBeInTheDocument();
    // Network mode label is visible. The honest status card also labels the
    // mode, so "Demo" now appears in more than one place — assert at least one
    // network-mode label is rendered.
    expect(screen.getAllByText(/demo/i).length).toBeGreaterThanOrEqual(1);
  });

  it("clears the composer after a successful send", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: GOLDEN } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText("Iced Coffee")).toBeInTheDocument(),
    );
    expect(input.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — clarification
// ---------------------------------------------------------------------------

describe("CommerceChat — clarification", () => {
  it("renders a clarification message and keeps the composer usable", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(CLARIFICATION));
    render(<CommerceChat networkMode="demo" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "buy iced coffee from river cafe" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/quantity is required/i)).toBeInTheDocument(),
    );
    // No preview card controls are rendered for a clarification.
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    // Composer is still usable for a follow-up.
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: GOLDEN } });
    expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — error recovery
// ---------------------------------------------------------------------------

describe("CommerceChat — error recovery", () => {
  it("renders an error message with a retry button on a fetch failure", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/network down/i),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    // Retry re-posts the same text and succeeds this time.
    fetchMock.mockReturnValue(jsonResponse(PREVIEW));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(screen.getByText("Iced Coffee")).toBeInTheDocument(),
    );
  });

  it("renders an error message on a non-OK HTTP response", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "server_error" }),
      } as unknown as Response),
    );
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/500|server/i),
    );
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — cancel / reopen confirm gate
// ---------------------------------------------------------------------------

describe("CommerceChat — cancel and reopen confirm gate", () => {
  it("cancel dismisses the preview controls and offers reopen", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Confirm/cancel are gone; reopen is now offered.
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reopen/i })).toBeInTheDocument();
  });

  it("reopen restores the confirm/cancel controls", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — checkout dialog reaches PaymentAction and settles
// ---------------------------------------------------------------------------

describe("CommerceChat — checkout dialog reaches a payable receipt", () => {
  it("confirm opens the dialog, continues to payment, and settles a DEMO receipt", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );

    // Inline preview Confirm opens the checkout dialog (review step).
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Iced Coffee")).toBeInTheDocument();
    expect(within(dialog).getByText(/6(\.0+)?\s*SUI/i)).toBeInTheDocument();

    // Continue to payment renders the real PaymentAction surface inside the
    // dialog — the payment step is reachable from the checkout dialog.
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    // PaymentAction is now mounted: its payable Confirm control is present
    // (only PaymentAction renders a "Confirm payment" button).
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /confirm payment/i }),
      ).toBeInTheDocument(),
    );
    // And it resolved to a DEMO simulation (no wallet/merchant configured).
    expect(
      within(dialog).getByText(/no on-chain settlement/i),
    ).toBeInTheDocument();

    // Settle the DEMO payment. The wallet is never called (strict real-vs-demo
    // gating: no merchant configured), and the dialog closes on terminal
    // settlement. The originating preview flipping to `confirmed` (asserted in
    // the next test) is the proof that onSettled fired with a receipt.
    fireEvent.click(
      within(dialog).getByRole("button", { name: /confirm payment/i }),
    );
    expect(wallet.signAndExecuteTransaction).not.toHaveBeenCalled();

    // The dialog closes after terminal settlement.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("after settlement the originating preview is confirmed and cannot double-fire", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /confirm payment/i }),
    );

    // Wait for the dialog to close on terminal settlement.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // The originating inline preview has transitioned to `confirmed`: its
    // Confirm and Cancel controls are gone (so it cannot open a second
    // checkout / double-fire a settlement) and it shows the terminal copy.
    expect(screen.getByText(/checkout complete/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reopen/i }),
    ).not.toBeInTheDocument();
  });

  it("cancelling the payment step closes the dialog without confirming the preview", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    // Cancel from the payment step (PaymentAction's own Cancel).
    fireEvent.click(
      within(dialog).getByRole("button", { name: /cancel/i }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // Cancellation must NOT mark confirmed: the inline preview is still
    // pending, so its Confirm/Cancel controls remain and no terminal copy
    // is shown. The user may retry by pressing Confirm again.
    expect(
      screen.queryByText(/checkout complete/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cancel/i }),
    ).toBeInTheDocument();
  });

  it("cancelling the review step closes the dialog without confirming the preview", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    const dialog = await screen.findByRole("dialog");
    // Cancel from the review step (before any payment surface is mounted).
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // No settlement happened: the preview is still pending.
    expect(
      screen.queryByText(/checkout complete/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — voice wiring
// ---------------------------------------------------------------------------

describe("CommerceChat — voice wiring", () => {
  it("clicking the mic button calls start() and shows the listening state", () => {
    render(<CommerceChat networkMode="demo" />);
    fireEvent.click(screen.getByRole("button", { name: /microphone/i }));
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("shows the interim transcript while listening", () => {
    voice.listening = true;
    voice.interimTranscript = "buy two";
    render(<CommerceChat networkMode="demo" />);
    expect(screen.getByText(/buy two/)).toBeInTheDocument();
  });

  it("fills the composer with the final transcript when recognition resolves", () => {
    render(<CommerceChat networkMode="demo" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(voice.onFinal).toBeDefined();
    act(() => {
      voice.onFinal!("buy two iced coffees");
    });
    // The chat wires onFinal to setInput, so the value reflects the final
    // transcript.
    expect(input.value).toBe("buy two iced coffees");
  });

  it("shows a text-fallback hint and no listening state when unsupported", () => {
    voice.supported = false;
    render(<CommerceChat networkMode="demo" />);
    expect(screen.getByText(/voice unavailable|text fallback/i)).toBeInTheDocument();
    // Mic button is disabled when unsupported.
    expect(screen.getByRole("button", { name: /microphone/i })).toBeDisabled();
  });

  it("stops voice on unmount", () => {
    const { unmount } = render(<CommerceChat networkMode="demo" />);
    unmount();
    expect(voice.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PurchasePreview — unit-level content
// ---------------------------------------------------------------------------

describe("PurchasePreview — content", () => {
  it("renders item, quantity, total SUI, merchant, and network mode", () => {
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="pending"
        onConfirm={() => {}}
        onCancel={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.getByText("Iced Coffee")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/6(\.0+)?\s*SUI/i)).toBeInTheDocument();
    expect(screen.getByText(/River Cafe/)).toBeInTheDocument();
    expect(screen.getByText(/demo/i)).toBeInTheDocument();
  });

  it("renders confirm and cancel controls when pending", () => {
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="pending"
        onConfirm={() => {}}
        onCancel={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
  });

  it("renders only reopen when cancelled", () => {
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="cancelled"
        onConfirm={() => {}}
        onCancel={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reopen/i })).toBeInTheDocument();
  });

  it("fires onConfirm and onCancel from its controls", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="pending"
        onConfirm={onConfirm}
        onCancel={onCancel}
        onReopen={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CheckoutDialog — content, step flow, and settlement seam
// ---------------------------------------------------------------------------

describe("CheckoutDialog — content and step flow", () => {
  it("renders nothing when closed", () => {
    render(
      <CheckoutDialog
        open={false}
        preview={PREVIEW}
        networkMode="demo"
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the validated preview and network mode on the review step when open", () => {
    render(
      <CheckoutDialog
        open={true}
        preview={PREVIEW}
        networkMode="demo"
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Iced Coffee")).toBeInTheDocument();
    expect(within(dialog).getByText(/6(\.0+)?\s*SUI/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/demo/i)).toBeInTheDocument();
    // Review step offers Continue to payment (not a direct settle).
    expect(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    ).toBeInTheDocument();
    // PaymentAction is not mounted yet on the review step.
    expect(
      within(dialog).queryByRole("button", { name: /confirm payment/i }),
    ).not.toBeInTheDocument();
  });

  it("review cancel closes the dialog without settling", () => {
    const onSettled = vi.fn();
    const onPaymentCancel = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CheckoutDialog
        open={true}
        preview={PREVIEW}
        networkMode="demo"
        onOpenChange={onOpenChange}
        onSettled={onSettled}
        onPaymentCancel={onPaymentCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSettled).not.toHaveBeenCalled();
    expect(onPaymentCancel).not.toHaveBeenCalled();
  });

  it("continue to payment mounts PaymentAction; settling fires onSettled and closes", async () => {
    const onSettled = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CheckoutDialog
        open={true}
        preview={PREVIEW}
        networkMode="demo"
        onOpenChange={onOpenChange}
        onSettled={onSettled}
      />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    // PaymentAction mounts in DEMO mode (no wallet/merchant in this test).
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /confirm payment/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /confirm payment/i }),
    );
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    const receipt = onSettled.mock.calls[0]![0];
    expect(receipt.demo).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("payment step cancel fires onPaymentCancel and closes without settling", () => {
    const onSettled = vi.fn();
    const onPaymentCancel = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CheckoutDialog
        open={true}
        preview={PREVIEW}
        networkMode="demo"
        onOpenChange={onOpenChange}
        onSettled={onSettled}
        onPaymentCancel={onPaymentCancel}
      />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /cancel/i }),
    );
    expect(onPaymentCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSettled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Responsive hit targets (44px)
// ---------------------------------------------------------------------------

describe("CommerceChat — hit targets", () => {
  it("primary controls meet the 44px minimum height", () => {
    render(<CommerceChat networkMode="demo" />);
    const send = screen.getByRole("button", { name: /send/i });
    const mic = screen.getByRole("button", { name: /microphone/i });
    expect(send.getAttribute("data-hit-target")).toBe("true");
    expect(mic.getAttribute("data-hit-target")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — empty state: clickable example prompts (no auto-submit)
// ---------------------------------------------------------------------------

describe("CommerceChat — empty state example prompts", () => {
  it("renders three clickable example prompt cards in the empty state", () => {
    render(<CommerceChat networkMode="demo" />);
    const prompts = screen.getAllByTestId("example-prompt");
    expect(prompts.length).toBe(3);
    for (const p of prompts) {
      expect(p.tagName).toBe("BUTTON");
      expect(p.getAttribute("data-example-prompt")).toBe("true");
    }
  });

  it("clicking an example prompt populates the composer only — never submits", () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe("");

    const prompts = screen.getAllByTestId("example-prompt");
    // The first example's full command is the golden prompt.
    const firstPrompt = prompts[0];
    expect(firstPrompt).toBeDefined();
    fireEvent.click(firstPrompt!);

    // The composer is populated with the full command...
    expect(input.value).toBe(GOLDEN);
    // ...but no fetch was issued (no submit) ...
    expect(fetchMock).not.toHaveBeenCalled();
    // ...and no user/assistant message was added to the thread: the empty
    //    state's example cards are still rendered (thread still empty).
    expect(screen.getAllByTestId("example-prompt").length).toBe(3);
    // The send button is now enabled (composer has text) but was NOT pressed.
    expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
  });

  it("each example prompt carries an accessible label naming the full command", () => {
    render(<CommerceChat networkMode="demo" />);
    const prompts = screen.getAllByTestId("example-prompt");
    for (const p of prompts) {
      const label = p.getAttribute("aria-label") ?? "";
      expect(label.startsWith("Try: ")).toBe(true);
      expect(label.length).toBeGreaterThan("Try: ".length);
    }
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — honest mode/status card
// ---------------------------------------------------------------------------

describe("CommerceChat — honest mode/status chip", () => {
  it("renders a DEMO status chip that labels simulation honestly", () => {
    render(<CommerceChat networkMode="demo" />);
    const status = screen.getByTestId("mode-status");
    expect(status.getAttribute("data-status-mode")).toBe("demo");
    expect(status).toHaveTextContent(/demo mode/i);
    // It must NOT fake a balance or a settlement.
    expect(status).not.toHaveTextContent(/balance/i);
    expect(status).not.toHaveTextContent(/settled|settlement complete/i);
  });

  it("renders a LIVE status chip labelling real testnet", () => {
    render(<CommerceChat networkMode="live" />);
    const status = screen.getByTestId("mode-status");
    expect(status.getAttribute("data-status-mode")).toBe("live");
    expect(status).toHaveTextContent(/live testnet/i);
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — compressed hero, judge run, and reactive safety lifecycle
// ---------------------------------------------------------------------------

describe("CommerceChat — compressed hero and judge run", () => {
  it("states one concise promise in the hero heading", () => {
    render(<CommerceChat networkMode="demo" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(/say it.*approve.*settle on sui/i);
  });

  it("renders a clearly labelled 60-second judge run button", () => {
    render(<CommerceChat networkMode="demo" />);
    const btn = screen.getByTestId("judge-run");
    expect(btn).toHaveTextContent(/60s judge run/i);
    expect(btn).not.toBeDisabled();
  });

  it("judge run populates and submits the golden prompt but never auto-confirms", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockReturnValue(jsonResponse(PREVIEW));

    render(<CommerceChat networkMode="demo" />);
    fireEvent.click(screen.getByTestId("judge-run"));

    // The golden prompt was posted to the typed intent endpoint.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/commerce/intent",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // The typed preview lands in the thread — but in `pending`, so Confirm
    // is offered (never auto-confirmed). No wallet/checkout dialog opens.
    expect(await screen.findByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("judge run is re-entry guarded while in flight", () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.click(screen.getByTestId("judge-run"));
    // While loading, the button is disabled.
    expect(screen.getByTestId("judge-run")).toBeDisabled();
  });
});

describe("CommerceChat — reactive safety lifecycle", () => {
  it("renders the four-phase safety lifecycle rail", () => {
    render(<CommerceChat networkMode="demo" />);
    const rail = screen.getByTestId("safety-lifecycle");
    expect(rail).toHaveTextContent(/language/i);
    expect(rail).toHaveTextContent(/validation/i);
    expect(rail).toHaveTextContent(/confirmation/i);
    expect(rail).toHaveTextContent(/settlement proof/i);
  });

  it("starts on the language phase when the thread is empty", () => {
    render(<CommerceChat networkMode="demo" />);
    const phase = screen.getByTestId("safety-lifecycle").querySelector(
      '[data-safety-phase="language"]',
    );
    expect(phase?.getAttribute("data-safety-active")).toBe("true");
  });

  it("advances to the confirmation phase once a typed preview lands", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    const phase = screen.getByTestId("safety-lifecycle").querySelector(
      '[data-safety-phase="confirmation"]',
    );
    expect(phase?.getAttribute("data-safety-active")).toBe("true");
  });
});

describe("CommerceChat — example prompts as financial action cards", () => {
  it("each prompt card carries a black accent spine and a trailing chevron", () => {
    render(<CommerceChat networkMode="demo" />);
    const prompts = screen.getAllByTestId("example-prompt");
    expect(prompts.length).toBe(3);
    for (const p of prompts) {
      // The black left accent spine that reads as a financial instrument row.
      expect(p.querySelector(".cv-prompt__accent")).not.toBeNull();
      // The trailing chevron signaling a tappable action.
      expect(p.querySelector(".cv-prompt__chevron")).not.toBeNull();
      // The amount line is rendered in tabular mono.
      const sub = p.querySelector(".font-mono");
      expect(sub).not.toBeNull();
    }
  });

  it("lays the empty-state prompts out in a compact multi-column grid on desktop", () => {
    render(<CommerceChat networkMode="demo" />);
    // The three example prompts share one responsive grid container that
    // collapses to a single column on mobile and expands to three columns
    // on desktop for a compact, width-using empty-state rhythm.
    const prompts = screen.getAllByTestId("example-prompt");
    const grid = prompts[0]!.parentElement;
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain("md:grid-cols-3");
    // The container is a grid (not a stacked flex), so the prompts flow into
    // columns rather than a tall single column.
    expect(grid!.className).toContain("grid");
  });

  it("collapses the empty-state thread to content on desktop (no giant min-height)", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    // The thread inset is the scroll container holding the empty state. When
    // empty it must NOT carry a desktop min-height that would force a tall
    // dead gray rectangle below the prompt cards; a small mobile min-height
    // is allowed for thumb-reach breathing room.
    const thread = container.querySelector(".cv-panel--inset");
    expect(thread).not.toBeNull();
    const cls = thread!.className;
    // No desktop min-height forces a giant void when empty.
    expect(cls).not.toContain("md:min-h-[340px]");
    expect(cls).not.toContain("md:min-h-[300px]");
    // A modest mobile min-height is kept for breathing room.
    expect(cls).toContain("min-h-[140px]");
  });

  it("restores the scroll-room min-height once a message is present", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    const { container } = render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText("Iced Coffee")).toBeInTheDocument(),
    );
    // Once populated, the thread regains its desktop min-height so a real
    // conversation has room to scroll rather than collapsing to content.
    const thread = container.querySelector(".cv-panel--inset");
    expect(thread).not.toBeNull();
    expect(thread!.className).toContain("md:min-h-[340px]");
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — monochrome shell: no blue visible-home classes
// ---------------------------------------------------------------------------

describe("CommerceChat — strict monochrome shell", () => {
  // Classes that would indicate a visible blue/hue on the home shell. None of
  // these may appear anywhere in the rendered commerce chat.
  const BLUE_CLASS_FRAGMENTS = [
    "cv-nav-chip--accent",
    "cv-btn__chip",
    "cv-glow",
    "cv-slab",
    "cv-footer-ground",
    "cv-navy-ground",
    "cv-light-wash",
    "cv-light-to-navy",
    "cv-navy-to-light",
  ];

  it("marks the shell root with a monochrome palette data attribute", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    const root = container.querySelector('[data-palette="monochrome"]');
    expect(root).not.toBeNull();
  });

  it("renders no blue/hue accent classes anywhere in the shell", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    const all = Array.from(container.querySelectorAll("*"));
    for (const el of all) {
      const cls = el.getAttribute("class") ?? "";
      for (const frag of BLUE_CLASS_FRAGMENTS) {
        if (cls.includes(frag)) {
          throw new Error(
            `monochrome shell leaked a blue/hue class "${frag}" on: ${cls}`,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — restrained motion (no infinite decorative animation)
// ---------------------------------------------------------------------------

describe("CommerceChat — restrained motion", () => {
  // Infinite decorative animation classes that must never appear on the home
  // shell. The functional loading tick (cv-tick) is allowed.
  const DECORATIVE_INFINITE = [
    "cv-marquee",
    "cv-drift",
    "cv-scanline",
    "cv-shimmer",
  ];

  it("uses a restrained entrance animation class on the primary panel", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    // The entrance utility is present (the global prefers-reduced-motion CSS
    // zeroes its duration for reduced-motion users).
    expect(container.querySelector(".cv-enter")).not.toBeNull();
  });

  it("renders no infinite decorative animation classes", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    for (const frag of DECORATIVE_INFINITE) {
      expect(container.querySelector(`.${frag}`)).toBeNull();
    }
  });

  it("example prompt cards use a hover/press transition, not an infinite loop", () => {
    render(<CommerceChat networkMode="demo" />);
    const prompts = screen.getAllByTestId("example-prompt");
    for (const p of prompts) {
      const cls = p.getAttribute("class") ?? "";
      // The prompt card uses the cv-prompt transition utility.
      expect(cls).toContain("cv-prompt");
      // And no decorative infinite animation.
      for (const frag of DECORATIVE_INFINITE) {
        expect(cls).not.toContain(frag);
      }
    }
  });
});
