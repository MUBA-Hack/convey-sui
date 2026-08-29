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
import { parseIntent } from "@/lib/commerce/intent";
import type { PaymentReceipt } from "@/lib/commerce/payment";

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
    // Network mode label is visible. The preview badge labels the demo
    // network as "Preview" and the network field as "Not submitted"; the
    // data-network-mode attribute still carries the canonical "demo" value.
    expect(screen.getAllByText(/Preview|Not submitted/i).length).toBeGreaterThanOrEqual(1);
    const modeChips = screen.getAllByTestId("purchase-preview").flatMap((el) =>
      Array.from(el.querySelectorAll("[data-network-mode]")),
    );
    expect(modeChips.some((el) => el.getAttribute("data-network-mode") === "demo")).toBe(true);
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
    // And it resolved to a preview (no wallet/merchant configured). The
    // PaymentAction mode label is the anchored "Preview — no on-chain
    // settlement" string; the dialog description also mentions no on-chain
    // settlement, so match the exact mode label.
    expect(
      within(dialog).getByText(/^Preview — no on-chain settlement$/),
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
    // checkout / double-fire a settlement) and the receipt object is shown
    // in place of the purchase detail table (one receipt object only).
    expect(screen.getAllByTestId("settlement-proof").length).toBeGreaterThan(0);
    // The purchase detail table is unmounted — the item name no longer
    // appears in the preview (the user's echoed command does not contain it).
    expect(screen.queryByText("Iced Coffee")).not.toBeInTheDocument();
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
    expect(screen.getByText(/^Preview$/)).toBeInTheDocument();
    expect(screen.getByText(/Not submitted/i)).toBeInTheDocument();
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
// PurchasePreview — confirmed receipt replaces the detail table (one object)
// ---------------------------------------------------------------------------

describe("PurchasePreview — confirmed receipt is one receipt object only", () => {
  const RECEIPT: PaymentReceipt = {
    mode: "demo",
    digest: "DEMO-abcdef0123456789",
    demo: true,
    explorerUrl: null,
    amountMist: "6000000000",
    merchantAddress: "0x".concat("11".repeat(32)),
    label: "DEMO simulation — no on-chain settlement",
  };

  it("unmounts the purchase detail table when a confirmed receipt exists", () => {
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="confirmed"
        receipt={RECEIPT}
        onConfirm={() => {}}
        onCancel={() => {}}
        onReopen={() => {}}
      />,
    );
    // The receipt object is shown.
    expect(screen.getByTestId("settlement-proof")).toBeInTheDocument();
    // The purchase detail table (item name, "Purchase preview" label, unit
    // price, quantity rows) is unmounted — only one receipt object remains.
    expect(screen.queryByText("Iced Coffee")).not.toBeInTheDocument();
    expect(screen.queryByText(/purchase preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unit price/i)).not.toBeInTheDocument();
  });

  it("renders exactly one receipt object (no nested duplicate)", () => {
    render(
      <PurchasePreview
        preview={PREVIEW}
        networkMode="demo"
        status="confirmed"
        receipt={RECEIPT}
        onConfirm={() => {}}
        onCancel={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.getAllByTestId("settlement-proof").length).toBe(1);
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
    expect(within(dialog).getByText(/^Preview$/)).toBeInTheDocument();
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
// CommerceChat — compressed hero and reactive safety lifecycle
// ---------------------------------------------------------------------------

describe("CommerceChat — compressed hero", () => {
  it("states one concise promise in the hero heading", () => {
    render(<CommerceChat networkMode="demo" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(/say it.*approve.*settle on sui/i);
  });

  it("keeps the mobile hero compact while reserving the cinematic treatment for desktop", () => {
    render(<CommerceChat networkMode="demo" />);

    const hero = screen.getByTestId("commerce-hero");
    const heading = screen.getByRole("heading", { level: 1 });

    expect(hero.className).toContain("text-black");
    expect(hero.className).toContain("md:bg-black");
    expect(hero.className).toContain("md:text-white");
    expect(heading.className).toContain("text-xl");
    expect(heading.className).toContain("md:text-4xl");
  });

  it("hides the long pitch and three-row proof rail from the mobile first viewport", () => {
    render(<CommerceChat networkMode="demo" />);

    const description = screen.getByTestId("hero-description");
    const proofRail = screen.getByTestId("hero-proof-rail");

    expect(description.className).toContain("hidden");
    expect(description.className).toContain("md:block");
    expect(proofRail.className).toContain("hidden");
    expect(proofRail.className).toContain("md:grid");
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

// ---------------------------------------------------------------------------
// CommerceChat — hero collapse + outcome stage object
// ---------------------------------------------------------------------------

describe("CommerceChat — hero collapse and outcome stage", () => {
  it("hides the slogan hero once the safety phase is proof (after settlement)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    // Hero is present before settlement.
    expect(screen.getByTestId("commerce-hero")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /confirm payment/i }),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("settlement-proof").length).toBeGreaterThan(0),
    );

    // The slogan hero is collapsed/hidden once the proof phase is reached so
    // the receipt monument — not the slogan — owns the first viewport.
    const hero = screen.queryByTestId("commerce-hero");
    if (hero) {
      // If the node is kept in the DOM it must be hidden on every viewport.
      expect(hero.className).toContain("hidden");
    }
  });

  it("renders an outcome stage object that fills the desktop canvas", () => {
    render(<CommerceChat networkMode="demo" />);
    const stage = screen.getByTestId("outcome-stage");
    // It is a desktop object (hidden on mobile to keep the mobile first
    // viewport compact), rendered as a block-level canvas-filling object.
    expect(stage.className).toContain("hidden");
    expect(stage.className).toContain("lg:flex");
  });

  it("outcome stage is a bounded black payment instrument card, not a full-width band", () => {
    render(<CommerceChat networkMode="demo" />);
    const stage = screen.getByTestId("outcome-stage");
    // The wrapper is TRANSPARENT — it must not carry the black band grammar
    // itself; the bounded card is a separate inner object.
    expect(stage.className).not.toContain("bg-black");
    // The bounded black card lives inside the wrapper.
    const card = screen.getByTestId("outcome-card");
    expect(card.className).toContain("bg-black");
    expect(card.className).toContain("text-white");
    // Strongly bounded: a max-width, rounded corners, and a soft shadow so it
    // reads as a discrete tactile object separate from the off-white page.
    expect(card.className).toContain("max-w-[420px]");
    expect(card.className).toContain("rounded-[28px]");
    expect(card.className).toMatch(/shadow-\[/);
    // Centered (not a full-width band).
    expect(card.className).toContain("mx-auto");
  });

  it("outcome stage is the desktop apex: it precedes the marketing hero in DOM order so money, not copy, owns the first viewport", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    const shell = container.querySelector('[data-palette="monochrome"]');
    expect(shell).not.toBeNull();
    // The first block-level instrument child is the outcome stage slab.
    const stage = shell!.querySelector('[data-testid="outcome-stage"]');
    const hero = shell!.querySelector('[data-testid="commerce-hero"]');
    expect(stage).not.toBeNull();
    expect(hero).not.toBeNull();
    // compareDocumentPosition: Node.DOCUMENT_POSITION_FOLLOWING = 4
    // The hero must come AFTER the stage in DOM order.
    expect(stage!.compareDocumentPosition(hero!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The marketing hero is collapsed on desktop so it cannot compete with
    // the slab for the first viewport.
    expect(hero!.className).toContain("lg:hidden");
    expect(stage!.className).not.toContain("mt-4");
  });

  it("places the payment instrument and complete command surface in one desktop grid", () => {
    render(<CommerceChat networkMode="demo" />);
    const workspace = screen.getByTestId("desktop-payment-workspace");
    const stage = screen.getByTestId("outcome-stage");
    const command = screen.getByTestId("command-workspace");
    expect(workspace.className).toContain("lg:grid-cols-");
    expect(stage.parentElement).toBe(workspace);
    expect(command.parentElement).toBe(workspace);
    expect(command).toContainElement(screen.getByRole("textbox"));
    expect(command).toContainElement(screen.getByRole("button", { name: /send/i }));
  });

  it("embeds the desktop lifecycle inside the command workspace", () => {
    render(<CommerceChat networkMode="demo" />);
    const command = screen.getByTestId("command-workspace");
    const lifecycle = screen.getByTestId("safety-lifecycle");
    expect(command).toContainElement(lifecycle);
    expect(lifecycle.className).toContain("grid-cols-4");
  });

  it("outcome stage shows a dormant black slab (0.00 SUI, AWAITING, dash digest) before any preview", () => {
    render(<CommerceChat networkMode="demo" />);
    const stage = screen.getByTestId("outcome-stage");
    expect(stage.getAttribute("data-outcome-phase")).toBe("language");
    // Black card grammar with white text — not a white explanatory hole.
    const card = screen.getByTestId("outcome-card");
    expect(card.className).toContain("bg-black");
    expect(card.className).toContain("text-white");
    // Status pill reads AWAITING before any intent.
    const pill = screen.getByTestId("outcome-status-pill");
    expect(pill.getAttribute("data-outcome-status")).toBe("awaiting");
    expect(pill).toHaveTextContent(/awaiting/i);
    // Huge tabular amount shows a dominant 0.00 + SUI at rest — a real zero,
    // not a ghosted dash — so money is the visual apex even when dormant.
    const amount = screen.getByTestId("outcome-amount");
    expect(amount).toHaveTextContent(/0\.00/i);
    expect(amount).toHaveTextContent(/sui/i);
    expect(amount).not.toHaveTextContent(/—/);
    // Digest mark is a dash before settlement — no fake digest.
    const digest = screen.getByTestId("outcome-digest");
    expect(digest).toHaveTextContent(/—/);
    // An explicit awaiting caption makes the dormant state honest.
    expect(screen.getByTestId("outcome-awaiting-caption")).toHaveTextContent(
      /awaiting/i,
    );
    // Honest: never fakes a settlement or balance.
    expect(card).not.toHaveTextContent(/settled|settlement complete/i);
    expect(card).not.toHaveTextContent(/balance/i);
    // No "Awaiting intent" paragraph or second headline remains.
    expect(card).not.toHaveTextContent(/awaiting intent/i);
  });

  it("outcome stage shows the validated amount, VALIDATED status, and no-settlement claim once a preview lands", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    const stage = screen.getByTestId("outcome-stage");
    expect(stage.getAttribute("data-outcome-phase")).toBe("confirmation");
    // The validated total (6 SUI) appears in the slab amount.
    const amount = screen.getByTestId("outcome-amount");
    expect(amount).toHaveTextContent(/6(\.0+)?\s*SUI/i);
    // Status pill reads VALIDATED after the preview lands.
    const pill = screen.getByTestId("outcome-status-pill");
    expect(pill.getAttribute("data-outcome-status")).toBe("validated");
    expect(pill).toHaveTextContent(/validated/i);
    // Digest is still a dash — validated is not settlement.
    const digest = screen.getByTestId("outcome-digest");
    expect(digest).toHaveTextContent(/—/);
    // Honest no-settlement claim is present for the validated state.
    expect(stage).toHaveTextContent(/not a settlement/i);
    // No fake settlement language.
    expect(stage).not.toHaveTextContent(/settled|settlement complete/i);
  });

  it("outcome stage shows the compact digest and PROOF status after settlement", async () => {
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
    await waitFor(() =>
      expect(screen.getAllByTestId("settlement-proof").length).toBeGreaterThan(0),
    );
    const stage = screen.getByTestId("outcome-stage");
    expect(stage.getAttribute("data-outcome-phase")).toBe("proof");
    // Status pill reads PROOF after settlement.
    const pill = screen.getByTestId("outcome-status-pill");
    expect(pill.getAttribute("data-outcome-status")).toBe("proof");
    expect(pill).toHaveTextContent(/proof/i);
    // Digest mark is the actual compact digest — not a dash.
    const digest = screen.getByTestId("outcome-digest");
    expect(digest).toHaveTextContent(/DEMO/i);
    expect(digest).not.toHaveTextContent(/—/);
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

// ---------------------------------------------------------------------------
// CommerceChat — preview/result messages use the full chat width
// ---------------------------------------------------------------------------

describe("CommerceChat — full-width preview/result messages", () => {
  it("renders a confirmed receipt in a full-width, flush result block (no bubble inset)", async () => {
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
    await waitFor(() =>
      expect(screen.getAllByTestId("settlement-proof").length).toBeGreaterThan(0),
    );

    // The wrapper around the thread receipt is a full-width result block that
    // does NOT inset the receipt with ordinary chat-bubble horizontal padding,
    // so identifiers and actions get the full thread width on mobile. The
    // thread receipt is the one nested inside a data-message-preview block
    // (the desktop outcome stage also renders a receipt monument).
    const threadReceipt = screen
      .getAllByTestId("settlement-proof")
      .find((el) => el.closest("[data-message-preview='true']") != null);
    expect(threadReceipt).toBeDefined();
    const wrapper = threadReceipt!.closest("[data-message-preview='true']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("w-full");
    expect(wrapper!.className).not.toContain("max-w-[90%]");
    expect(wrapper!.className).not.toContain("px-3.5");
  });

  it("keeps ordinary assistant text bubbles constrained and padded", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(CLARIFICATION));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "buy iced coffee from river cafe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/quantity is required/i)).toBeInTheDocument(),
    );

    // An ordinary assistant clarification is a constrained, padded chat
    // bubble — not a full-width result block.
    const bubble = screen
      .getByText(/quantity is required/i)
      .closest("[data-message-preview='false']");
    expect(bubble).not.toBeNull();
    expect(bubble!.className).toContain("max-w-[90%]");
    expect(bubble!.className).toContain("px-3.5");
  });
});

// ---------------------------------------------------------------------------
// CommerceChat — outcome slab readiness zone (payment instrument, not billboard)
// ---------------------------------------------------------------------------

describe("CommerceChat — outcome slab readiness zone", () => {
  it("renders a large central readiness target in the AWAITING card", () => {
    render(<CommerceChat networkMode="demo" />);
    const readiness = screen.getByTestId("outcome-readiness");
    // The readiness target is CENTRAL (a flex column centered in the card),
    // not a vacant fixed-width right column.
    expect(readiness.className).toContain("flex-col");
    expect(readiness.className).toContain("items-center");
    expect(readiness.className).not.toContain("lg:w-[200px]");
    // It carries an honest idle state marker.
    expect(readiness.getAttribute("data-readiness")).toBe("idle");
    // The readiness rings are LARGE — they occupy a meaningful share of the
    // card area, not a faint corner glyph (>= 160px).
    const svg = readiness.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(Number(svg!.getAttribute("width"))).toBeGreaterThanOrEqual(160);
  });

  it("idle readiness label invites input without implying recording", () => {
    voice.supported = true;
    voice.listening = false;
    render(<CommerceChat networkMode="demo" />);
    const label = screen.getByTestId("outcome-readiness-label");
    expect(label).toHaveTextContent(/say or type to begin/i);
    // Honest: idle must NOT claim listening/recording.
    expect(label.getAttribute("data-readiness-listening")).toBeFalsy();
    expect(label).not.toHaveTextContent(/listening/i);
  });

  it("listening readiness label honestly reflects an active recognition session", () => {
    voice.supported = true;
    voice.listening = true;
    render(<CommerceChat networkMode="demo" />);
    const readiness = screen.getByTestId("outcome-readiness");
    expect(readiness.getAttribute("data-readiness")).toBe("listening");
    const label = screen.getByTestId("outcome-readiness-label");
    expect(label).toHaveTextContent(/listening/i);
    expect(label.getAttribute("data-readiness-listening")).toBe("true");
  });

  it("unsupported voice shows a type-only readiness label (no false SAY)", () => {
    voice.supported = false;
    voice.listening = false;
    render(<CommerceChat networkMode="demo" />);
    const label = screen.getByTestId("outcome-readiness-label");
    expect(label).toHaveTextContent(/type to begin/i);
    expect(label).not.toHaveTextContent(/say/i);
  });

  it("readiness zone never implies transaction, funds, settlement, or NFC", () => {
    render(<CommerceChat networkMode="demo" />);
    const readiness = screen.getByTestId("outcome-readiness");
    const label = screen.getByTestId("outcome-readiness-label");
    // The readiness copy stays honest about what is NOT happening: it must
    // not claim a transaction, funds, settlement, NFC, or recording. (The
    // left column's "no transaction yet" caption is a separate honest
    // negative claim, scoped to the amount column, not the readiness zone.)
    expect(readiness).not.toHaveTextContent(/\btransaction\b/i);
    expect(readiness).not.toHaveTextContent(/\bfunds\b/i);
    expect(readiness).not.toHaveTextContent(/settled|settlement complete/i);
    expect(readiness).not.toHaveTextContent(/\bnfc\b/i);
    expect(readiness).not.toHaveTextContent(/recording/i);
    expect(label).not.toHaveTextContent(/\btransaction\b/i);
    expect(label).not.toHaveTextContent(/\bfunds\b/i);
    expect(label).not.toHaveTextContent(/settl/i);
    expect(label).not.toHaveTextContent(/\bnfc\b/i);
  });

  it("readiness rings are static (no infinite decorative animation)", () => {
    const { container } = render(<CommerceChat networkMode="demo" />);
    const readiness = screen.getByTestId("outcome-readiness");
    const svg = readiness.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    // No decorative infinite animation classes leak onto the readiness zone.
    for (const frag of ["cv-marquee", "cv-drift", "cv-scanline", "cv-shimmer"]) {
      expect(readiness.querySelector(`.${frag}`)).toBeNull();
    }
    // The whole shell still has no decorative infinite animation.
    for (const frag of ["cv-marquee", "cv-drift", "cv-scanline", "cv-shimmer"]) {
      expect(container.querySelector(`.${frag}`)).toBeNull();
    }
  });

  it("readiness zone disappears deliberately once a preview lands (VALIDATED)", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    // The readiness zone is gone once the instrument carries a value; the
    // amount/digest column owns the full width.
    expect(screen.queryByTestId("outcome-readiness")).not.toBeInTheDocument();
    expect(screen.queryByTestId("outcome-readiness-label")).not.toBeInTheDocument();
    // The slab still shows the validated amount and honest no-settlement claim.
    expect(screen.getByTestId("outcome-amount")).toHaveTextContent(/6(\.0+)?\s*SUI/i);
    expect(screen.getByTestId("outcome-stage")).toHaveTextContent(/not a settlement/i);
  });

  it("readiness zone stays gone after settlement (PROOF)", async () => {
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
    await waitFor(() =>
      expect(screen.getAllByTestId("settlement-proof").length).toBeGreaterThan(0),
    );
    // No readiness zone in the proof state.
    expect(screen.queryByTestId("outcome-readiness")).not.toBeInTheDocument();
    // The compact digest is shown instead.
    expect(screen.getByTestId("outcome-digest")).toHaveTextContent(/DEMO/i);
  });

  it("amount and SUI are tightly coupled as one currency object (amount largest)", () => {
    render(<CommerceChat networkMode="demo" />);
    const amount = screen.getByTestId("outcome-amount");
    // The amount and its SUI suffix live in the same tabular-nums line.
    expect(amount.className).toContain("tabular-nums");
    expect(amount).toHaveTextContent(/0\.00/i);
    expect(amount).toHaveTextContent(/sui/i);
    // The SUI suffix is a child span with a tight margin (not far separated).
    const sui = amount.querySelector("span");
    expect(sui).not.toBeNull();
    expect(sui!.className).toContain("ml-1.5");
    // The amount remains the dominant typographic element in the tray: its
    // md size is 48px, larger than the SUI suffix (16px) and the overline.
    expect(amount.className).toContain("md:text-[48px]");
    expect(sui!.className).toContain("md:text-[16px]");
  });

  it("fuses amount and interaction cue on one white inset tray near the card bottom", () => {
    render(<CommerceChat networkMode="demo" />);
    const amount = screen.getByTestId("outcome-amount");
    const cue = screen.getByTestId("outcome-action-cue");
    // Both the amount and the mic/arrow cue share the SAME white inset tray
    // (their nearest common ancestor is the white surface), so amount and
    // action are never separated by a void.
    const tray = amount.closest(".bg-white");
    expect(tray).not.toBeNull();
    expect(cue.closest(".bg-white")).toBe(tray);
    // The tray is white inset on the black card — high contrast, tactile.
    expect(tray!.className).toContain("bg-white");
    expect(tray!.className).toContain("rounded-2xl");
    // The cue carries a mic glyph and an arrow glyph (SVGs).
    expect(cue.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("exposes the listening-off state to assistive tech (no false listening implication)", () => {
    voice.supported = true;
    voice.listening = false;
    const { container } = render(<CommerceChat networkMode="demo" />);
    // A visually-hidden aria-live region states the microphone is off and no
    // transaction is in progress, so "listening off" is never merely implied.
    const live = container.querySelector('[aria-live="polite"].sr-only');
    expect(live).not.toBeNull();
    expect(live!.textContent).toMatch(/microphone off/i);
    expect(live!.textContent).toMatch(/no transaction/i);
  });

  it("announces an active listening session to assistive tech", () => {
    voice.supported = true;
    voice.listening = true;
    const { container } = render(<CommerceChat networkMode="demo" />);
    const live = container.querySelector('[aria-live="polite"].sr-only');
    expect(live).not.toBeNull();
    expect(live!.textContent).toMatch(/microphone on/i);
    expect(live!.textContent).toMatch(/listening/i);
  });

  it("stays coherent when readiness rings transform: VALIDATED shows a stage mark, readiness gone", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(jsonResponse(PREVIEW));
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: GOLDEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument(),
    );
    // The readiness target is gone; a coherent stage mark occupies the center.
    expect(screen.queryByTestId("outcome-readiness")).not.toBeInTheDocument();
    const mark = screen.getByTestId("outcome-stage-mark");
    expect(mark.getAttribute("data-stage-mark")).toBe("validated");
    // The card still shows the validated amount and honest no-settlement claim.
    expect(screen.getByTestId("outcome-amount")).toHaveTextContent(/6(\.0+)?\s*SUI/i);
    expect(screen.getByTestId("outcome-card")).toHaveTextContent(/not a settlement/i);
  });
});

// ---------------------------------------------------------------------------
// Canned example prompts — every visible canned example must be a reliable
// golden path. Clicking a card populates the composer with its command;
// clicking Send must submit EXACTLY that command (the submitted user message
// and limit must never drift), and the response — produced through the SAME
// real parser/catalog path the UI uses at runtime — must be a pending
// validated preview whose displayed merchant/item/quantity match the card and
// whose total never exceeds the displayed cap. No auto-confirm or settlement.
// ---------------------------------------------------------------------------

/** fetch mock backed by the REAL parseIntent + catalog, mirroring the
 *  /api/commerce/intent contract (zod { text } → parseIntent → JSON). */
function realIntentFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as { text: string }) : { text: "" };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(parseIntent(body.text)),
    } as unknown as Response);
  });
}

const CANNED_EXAMPLES = [
  {
    label: "Two iced coffees",
    sub: "River Cafe · under 8 SUI",
    command: "Buy two iced coffees under 8 SUI from River Cafe",
    expectItem: "Iced Coffee",
    expectMerchant: "River Cafe",
    expectQuantity: 2,
  },
  {
    label: "Lunch bowl",
    sub: "Green Kitchen · under 12 SUI",
    command: "Order one lunch bowl under 12 SUI from Green Kitchen",
    expectItem: "Lunch Bowl",
    expectMerchant: "Green Kitchen",
    expectQuantity: 1,
  },
  {
    label: "Three cold brews",
    sub: "Daybreak Coffee · under 6 SUI",
    command: "Get three cold brews under 6 SUI from Daybreak Coffee",
    expectItem: "Cold Brew",
    expectMerchant: "Daybreak Coffee",
    expectQuantity: 3,
  },
] as const;

describe("CommerceChat — canned example prompts", () => {
  it("renders exactly the three visible canned example cards", () => {
    render(<CommerceChat networkMode="demo" />);
    const cards = screen.getAllByTestId("example-prompt");
    expect(cards).toHaveLength(3);
    // Each label is visible.
    for (const ex of CANNED_EXAMPLES) {
      expect(screen.getByText(ex.label)).toBeInTheDocument();
    }
  });

  it.each(CANNED_EXAMPLES)(
    "$label: clicking the card populates the composer with the exact command (no drift before send)",
    (ex) => {
      render(<CommerceChat networkMode="demo" />);
      const input = screen.getByRole("textbox") as HTMLTextAreaElement;
      // Find the example card by its aria-label which embeds the full command.
      fireEvent.click(screen.getByRole("button", { name: `Try: ${ex.command}` }));
      expect(input.value).toBe(ex.command);
    },
  );

  it.each(CANNED_EXAMPLES)(
    "$label: send submits the exact command and reaches a pending validated preview with displayed merchant/item/qty and total <= cap",
    async (ex) => {
      const fetchMock = realIntentFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(<CommerceChat networkMode="demo" />);
      const input = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Click the canned example, then Send — the production dogfood path.
      fireEvent.click(screen.getByRole("button", { name: `Try: ${ex.command}` }));
      expect(input.value).toBe(ex.command);
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      // The submitted request body is EXACTLY the selected command — the
      // submitted user message and limit must never drift from the card.
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/commerce/intent",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ text: ex.command }),
          }),
        ),
      );

      // The echoed user chat bubble shows the exact command (no limit drift).
      // The golden prompt also appears as an always-visible header hint, so
      // assert at least one element renders the exact command text.
      expect(screen.getAllByText(ex.command).length).toBeGreaterThanOrEqual(1);

      // A pending validated preview lands — not a clarification, not a
      // settlement. The displayed merchant/item/quantity match the card.
      await waitFor(() =>
        expect(screen.getByTestId("purchase-preview")).toBeInTheDocument(),
      );
      expect(screen.queryByText(/not found in catalog/i)).not.toBeInTheDocument();
      // Scope merchant/item/quantity to the preview card so the assertions
      // do not collide with the always-visible safety-lifecycle step numbers
      // (1-4) or the golden-prompt header hint.
      const preview = screen.getByTestId("purchase-preview");
      expect(within(preview).getByText(ex.expectItem)).toBeInTheDocument();
      expect(within(preview).getAllByText(ex.expectMerchant).length).toBeGreaterThan(0);
      expect(within(preview).getByText(String(ex.expectQuantity))).toBeInTheDocument();

      // The preview is pending: Confirm + Cancel are present; no settlement
      // proof is rendered (no auto-confirm or fake settlement).
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      expect(screen.queryAllByTestId("settlement-proof")).toHaveLength(0);

      // The composer is cleared after the send.
      expect(input.value).toBe("");
    },
  );
});
