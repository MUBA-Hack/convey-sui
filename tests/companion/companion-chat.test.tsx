// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanionChat } from "@/components/companion/companion-chat";
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
});

afterEach(() => {
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
