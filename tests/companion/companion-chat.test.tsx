// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanionChat } from "@/components/companion/companion-chat";
import { SAMPLE_COMPANION_MEMORY } from "@/components/companion/sample-context";
import {
  buildProtectedSupportDemoTrace,
  ProtectedSupportDemoCard,
} from "@/components/companion/protected-support-demo-card";
import {
  buildThetanutsDemoTrace,
  ThetanutsExecutionDemo,
} from "@/components/companion/thetanuts-execution-demo";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Companion demo lifecycles", () => {
  it("derives the protected-support replay from the lifecycle state machine", () => {
    const trace = buildProtectedSupportDemoTrace();
    expect(trace.map((state) => state.status)).toEqual([
      "created",
      "evidence_approved",
      "released",
    ]);
    expect(trace.at(-1)?.settlement).toBe("not_submitted");
  });

  it("links the protected-support story to the real public reference without merging claims", () => {
    render(<ProtectedSupportDemoCard amountMajor="1" />);

    expect(screen.getByRole("link", { name: /release/i })).toHaveAttribute(
      "href",
      "https://suiscan.xyz/testnet/tx/HUcinKrEMfwcSf3XRcyWabRFWYroXrVdg6umdZChPgcV",
    );
    expect(screen.getByRole("link", { name: /refund/i })).toHaveAttribute(
      "href",
      "https://suiscan.xyz/testnet/tx/7x5YRgTCSQMadUmswaBqXkfk8EARUwnE7CYkija5GKCv",
    );
    expect(screen.getByText(/public reference proves a separate 1 USDC on-chain lifecycle/i)).toBeInTheDocument();
    expect(screen.getByText(/^1$/)).toBeInTheDocument();
    expect(screen.getByText(/this card remains a local replay, not a fiat payout/i)).toBeInTheDocument();
  });

  it("presents the completed Sui lifecycle as a first-class public replay", () => {
    render(<ProtectedSupportDemoCard amountMajor="1" referenceMode />);

    expect(screen.getByRole("heading", { name: /1 usdc moved by contract/i })).toBeInTheDocument();
    expect(screen.getByText(/completed on sui testnet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lock transaction/i })).toHaveAttribute(
      "href",
      "https://suiscan.xyz/testnet/tx/BWiZmTbtNU6Tm9g3SDNrD6RbmxHsTyjgmssqJxamRM4P",
    );
    expect(screen.getByRole("link", { name: /release transaction/i })).toHaveAttribute(
      "href",
      "https://suiscan.xyz/testnet/tx/HUcinKrEMfwcSf3XRcyWabRFWYroXrVdg6umdZChPgcV",
    );
    expect(screen.getByRole("link", { name: /view contract/i })).toHaveAttribute(
      "href",
      "https://suiscan.xyz/testnet/object/0xcf84c52207baff1b193bd01d7700aefb92c1232de3fdce8dd5cd0898600bbb5f",
    );
  });

  it("plays protected support and keeps simulation truth in details", async () => {
    vi.useFakeTimers();
    render(<ProtectedSupportDemoCard />);
    fireEvent.click(screen.getByRole("button", { name: /play protected journey/i }));
    for (let step = 0; step < 3; step += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(700));
    }
    expect(screen.getByText("Ready for Ana").closest("[data-reached]"))
      .toHaveAttribute("data-reached", "true");
    fireEvent.click(screen.getByText(/about this replay/i));
    expect(screen.getByText(/no sui transaction was signed/i)).toBeInTheDocument();
  });

  it("derives a verified simulated receipt from the execution journal", () => {
    const trace = buildThetanutsDemoTrace();
    expect(trace.map((state) => state.status)).toEqual([
      "policy_reviewed",
      "approval_confirmed",
      "pending_verification",
      "verified",
    ]);
    expect(trace.at(-1)?.receipt?.evidence).toBe("simulated");
  });

  it("plays the guarded options sequence without presenting a live fill", async () => {
    vi.useFakeTimers();
    render(<ThetanutsExecutionDemo />);
    fireEvent.click(screen.getByRole("button", { name: /run overnight policy/i }));
    for (let step = 0; step < 4; step += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(700));
    }
    expect(screen.getByText("Policy replay complete").closest("[data-reached]"))
      .toHaveAttribute("data-reached", "true");
    fireEvent.click(screen.getByText(/replay evidence/i));
    expect(screen.getByText(/no wallet request, order broadcast, or live fill occurred/i)).toBeInTheDocument();
  });
});

describe("CompanionChat", () => {
  it("opens the smart contract demo without requiring a chat prompt", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);

    fireEvent.click(screen.getByRole("button", { name: /demo smart contract/i }));

    expect(screen.getByRole("dialog", { name: /smart contract demo/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /1 usdc moved by contract/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close smart contract demo/i })).toBeInTheDocument();
  });

  it("keeps every promoted recipient available in sample memory", () => {
    render(<CompanionChat memoryMode="sample" initialMemory={SAMPLE_COMPANION_MEMORY} />);
    expect(screen.getByText(/sample people · dave, ana/i)).toBeInTheDocument();
    expect(SAMPLE_COMPANION_MEMORY.contacts.map((contact) => contact.displayName)).toEqual(["Dave", "Ana"]);
  });

  it("keeps sample context explicit until the user chooses device-local memory", async () => {
    const memory = {
      version: "convey.companion-memory.v1" as const,
      ownerLabel: null,
      contacts: [{ id: "dave", displayName: "Dave", aliases: [], relationshipLabel: "friend", address: `0x${"1".repeat(64)}`, previousAddress: null, confirmation: "confirmed" as const, confirmedAt: 1 }],
      interactions: [],
    };
    const view = render(<CompanionChat memoryMode="sample" initialMemory={memory} />);

    expect(screen.getByText(/sample person · dave/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /manage remembered people/i }));
    fireEvent.click(screen.getByRole("button", { name: /remember on this device/i }));

    await waitFor(() => expect(screen.getByText(/1 remembered person/i)).toBeInTheDocument());
    expect(window.localStorage.getItem("convey.companion-memory.v1")).toContain('"displayName":"Dave"');

    view.unmount();
    render(<CompanionChat memoryMode="sample" initialMemory={memory} />);
    await waitFor(() => expect(screen.getByText(/1 remembered person/i)).toBeInTheDocument());
    expect(screen.queryByText(/sample person/i)).toBeNull();
  });

  it("disables voice honestly when speech recognition is unavailable", () => {
    render(<CompanionChat />);
    expect(screen.getByRole("button", { name: /start voice input/i })).toBeDisabled();
    expect(screen.getByText(/voice input is unavailable in this browser/i)).toBeInTheDocument();
  });

  it("moves a final speech transcript into the composer without submitting", async () => {
    let recognition: {
      onresult: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    } | null = null;
    class SpeechRecognitionMock {
      static latest: SpeechRecognitionMock | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        SpeechRecognitionMock.latest = this;
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = SpeechRecognitionMock;
    render(<CompanionChat />);

    fireEvent.click(screen.getByRole("button", { name: /start voice input/i }));
    recognition = SpeechRecognitionMock.latest;
    expect(screen.getByText(/listening/i)).toBeInTheDocument();
    act(() => {
      recognition?.onresult?.({
        resultIndex: 0,
        results: Object.assign([[{ transcript: "Pay Dave 12 USDC" }]], { 0: Object.assign([{ transcript: "Pay Dave 12 USDC" }], { isFinal: true }), length: 1 }),
      });
    });
    expect(screen.getByLabelText(/companion message/i)).toHaveValue("Pay Dave 12 USDC");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("renders starter prompts and sends a turn request", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        toolId: "payments.propose",
        outcome: "proposal",
        routing: {
          provider: "deterministic",
          mode: "fallback",
          requestId: null,
          responseModel: null,
          fallbackReason: "deterministic_only",
        },
        candidate: null,
        proposal: {
          toolId: "payments.propose",
          contactId: "dave",
          contactLabel: "Dave",
          amountMajor: "12",
          asset: "USDC",
          purpose: "dinner",
          requiresUserApproval: true,
        },
        clarification: null,
      }),
    } as Response);

    render(
      <CompanionChat
        initialMemory={{
          version: "convey.companion-memory.v1",
          ownerLabel: null,
          contacts: [
            {
              id: "dave",
              displayName: "Dave",
              aliases: [],
              relationshipLabel: "friend",
              address: "0x" + "1".repeat(64),
              previousAddress: null,
              confirmation: "confirmed",
              confirmedAt: 1_700_000_000_000,
            },
          ],
          interactions: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^pay dave 12 usdc$/i }));
    fireEvent.change(screen.getByLabelText(/companion message/i), {
      target: { value: "Pay Dave 12 USDC for dinner" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/companion/turn",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/ready to review/i)).toBeInTheDocument(),
    );
  });

  it("labels prototype memory instead of presenting it as persisted memory", () => {
    render(
      <CompanionChat
        memoryMode="sample"
        initialMemory={{
          version: "convey.companion-memory.v1",
          contacts: [{ id: "dave", displayName: "Dave", aliases: [], relationshipLabel: "friend", address: `0x${"1".repeat(64)}`, previousAddress: null, confirmation: "confirmed", confirmedAt: 1 }],
          interactions: [],
        }}
      />,
    );
    expect(screen.getByText(/sample person · dave/i)).toBeInTheDocument();
  });

  it("shows a receipt intake as the next step for a split request", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        toolId: "splits.propose",
        outcome: "unavailable",
        routing: { provider: "deterministic", mode: "fallback", requestId: null, responseModel: null, fallbackReason: "deterministic_only" },
        candidate: null,
        proposal: null,
        clarification: null,
      }),
    } as Response);
    render(<CompanionChat />);
    fireEvent.change(screen.getByLabelText(/companion message/i), { target: { value: "Split this receipt" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByRole("heading", { name: /turn one bill into clear requests/i })).toBeInTheDocument();
    expect(screen.getByText(/choose receipt photo/i)).toBeInTheDocument();
  });
});
