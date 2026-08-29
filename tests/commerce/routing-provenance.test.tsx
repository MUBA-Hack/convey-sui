// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { CommerceChat } from "@/components/commerce/commerce-chat";
import type {
  PurchaseIntentPreview,
  PurchaseIntentClarification,
  RoutingMetadata,
} from "@/lib/commerce/intent";

const GOLDEN = "Buy two iced coffees under 8 SUI from River Cafe";

const PREVIEW: PurchaseIntentPreview = {
  kind: "preview",
  action: "buy",
  item: { id: "iced-coffee", name: "Iced Coffee" },
  quantity: 2,
  unitPriceMist: "3000000000",
  totalMist: "6000000000",
  priceCeilingMist: "8000000000",
  merchant: { id: "river-cafe", name: "River Cafe", address: null },
  confidence: 1,
  clarification: null,
};

const LIVE_ROUTING: RoutingMetadata = {
  provider: "gonkarouter",
  mode: "live",
  requestId: "req_abc123def456",
  requestedModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
  responseModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
  latencyMs: 420,
  usage: { inputTokens: 42, outputTokens: 7 },
  detectedLanguage: "en",
  confidence: 0.95,
  explanation: "User asked for two iced coffees from River Cafe.",
};

const FALLBACK_ROUTING: RoutingMetadata = {
  provider: "deterministic",
  mode: "fallback",
  fallbackReason: "not_configured",
};

const CLARIFICATION: PurchaseIntentClarification = {
  kind: "clarification",
  action: "buy",
  clarification: { code: "missing_quantity", reason: "Quantity is required." },
  item: null,
  quantity: null,
  merchant: null,
};

// Hoisted voice hook mock (the chat imports useVoiceInput).
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

// Stub dapp-kit so any reachable PaymentAction stays in DEMO mode.
const wallet = vi.hoisted(() => ({
  account: null as { address: string } | null,
  network: "testnet" as string,
  signAndExecuteTransaction: vi.fn(),
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentNetwork: () => wallet.network,
  useDAppKit: () => ({ signAndExecuteTransaction: wallet.signAndExecuteTransaction }),
}));

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

async function sendPrompt(prompt: string): Promise<void> {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() =>
    expect(screen.getByTestId("routing-provenance")).toBeInTheDocument(),
  );
}

describe("CommerceChat — Gonka live routing provenance badge", () => {
  it("surfaces a GONKA ROUTED badge with a short model and request id on a live route", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: LIVE_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    expect(badge.getAttribute("data-routing-provider")).toBe("gonkarouter");
    expect(badge.getAttribute("data-routing-mode")).toBe("live");
    expect(badge).toHaveTextContent(/gonka routed/i);
    // Short model (last path segment) is visible.
    expect(badge).toHaveTextContent(/DeepSeek-V4-Flash-0731/i);
    // Truncated request id is visible.
    expect(badge).toHaveTextContent(/req_abc/i);
    // Full model + request id are kept in data attributes for judges.
    expect(badge.getAttribute("data-routing-model")).toBe(
      "deepseek-ai/DeepSeek-V4-Flash-0731",
    );
    expect(badge.getAttribute("data-routing-request-id")).toBe("req_abc123def456");
  });

  it("exposes an accessible label naming GonkaRouter, the model, and the request id", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: LIVE_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    const a11y = badge.getAttribute("aria-label") ?? "";
    expect(a11y).toMatch(/routed by gonkarouter/i);
    expect(a11y).toContain("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(a11y).toContain("req_abc123def456");
    // A visually-hidden copy reinforces the same fact for screen readers.
    expect(badge.querySelector(".sr-only")).not.toBeNull();
  });

  it("never shows the API key, base URL, or raw provider error in the badge", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: LIVE_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    const text = badge.textContent ?? "";
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("apiKey");
    expect(text.toLowerCase()).not.toContain("base_url");
    expect(text.toLowerCase()).not.toContain("error");
  });
});

describe("CommerceChat — fallback routing provenance badge", () => {
  it("surfaces a LOCAL SAFETY ROUTE label that never implies Gonka ran", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: FALLBACK_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    expect(badge.getAttribute("data-routing-provider")).toBe("deterministic");
    expect(badge.getAttribute("data-routing-mode")).toBe("fallback");
    // The raw reason enum is preserved as structured metadata for judges.
    expect(badge.getAttribute("data-routing-reason")).toBe("not_configured");
    // The visible label is a quiet human label — never the raw snake_case enum.
    expect(badge).toHaveTextContent(/local safety route/i);
    expect(badge).not.toHaveTextContent(/not_configured/i);
    // It must NOT claim Gonka routed.
    expect(badge).not.toHaveTextContent(/gonka routed/i);
    expect(badge).not.toHaveTextContent(/gonkarouter/i);
    // No request id / model on a fallback.
    expect(badge.getAttribute("data-routing-request-id")).toBeFalsy();
    expect(badge.getAttribute("data-routing-model")).toBeFalsy();
  });

  it("exposes an accessible label naming the local safety route and the humanized reason", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: FALLBACK_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    const a11y = badge.getAttribute("aria-label") ?? "";
    expect(a11y).toMatch(/local safety route/i);
    // The raw snake_case enum is humanized for assistive tech, not leaked raw.
    expect(a11y).toContain("not configured");
    expect(a11y).not.toContain("not_configured");
    // A visually-hidden copy reinforces the same fact for screen readers.
    expect(badge.querySelector(".sr-only")).not.toBeNull();
  });

  it("keeps the raw reason enum out of the visible body but exposes it humanized (not raw error text)", async () => {
    const routing: RoutingMetadata = {
      provider: "deterministic",
      mode: "fallback",
      fallbackReason: "timeout",
    };
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing }),
    );
    render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    // The raw reason enum is preserved as structured metadata for judges.
    expect(badge.getAttribute("data-routing-reason")).toBe("timeout");
    // The raw enum is NOT rendered in the visible (aria-hidden) label.
    const visibleLabel = badge.querySelector("span[aria-hidden]");
    expect(visibleLabel?.textContent ?? "").not.toMatch(/timeout/i);
    // The humanized reason is exposed to assistive tech via aria-label, not
    // the raw enum.
    const a11y = badge.getAttribute("aria-label") ?? "";
    expect(a11y).toContain("timeout");
    // The raw provider error category text must not leak visibly.
    expect(visibleLabel?.textContent ?? "").not.toMatch(/PROVIDER_ERROR/i);
  });

  it("renders a fallback label on a clarification turn too", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...CLARIFICATION, routing: FALLBACK_ROUTING }),
    );
    render(<CommerceChat networkMode="demo" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "buy iced coffee from river cafe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByTestId("routing-provenance")).toBeInTheDocument(),
    );
    const badge = screen.getByTestId("routing-provenance");
    expect(badge).toHaveTextContent(/local safety route/i);
  });
});

describe("CommerceChat — routing badge stays compact and monochrome", () => {
  it("the live badge does not leak blue/hue accent classes", async () => {
    vi.mocked(globalThis.fetch).mockReturnValue(
      jsonResponse({ ...PREVIEW, routing: LIVE_ROUTING }),
    );
    const { container } = render(<CommerceChat networkMode="demo" />);
    await sendPrompt(GOLDEN);

    const badge = screen.getByTestId("routing-provenance");
    const cls = badge.getAttribute("class") ?? "";
    for (const frag of [
      "cv-nav-chip--accent",
      "cv-btn__chip",
      "cv-glow",
      "cv-slab",
    ]) {
      expect(cls).not.toContain(frag);
    }
    // No decorative infinite animation on the badge.
    for (const frag of ["cv-marquee", "cv-drift", "cv-scanline", "cv-shimmer"]) {
      expect(container.querySelector(`.${frag}`)).toBeNull();
    }
  });
});
