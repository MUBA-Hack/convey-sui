// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import {
  FamilyStewardCard,
} from "@/components/remittance/family-steward-card";
import { FamilyGuardianCard } from "@/components/remittance/family-guardian-card";

const ADDR = "0x" + "ab".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };
const NOW = 1_700_000_000_000;

function baseQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.444444 PHP" },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: "109000000",
    usdcAmount: "109",
    settlementRail: "Sui testnet USDC",
    payoutMethod: "Bank payout · Not available yet",
    estimatedArrival: "Within minutes after on-chain confirmation",
    payoutStatus: "Awaiting payout partner",
    issuedAt: NOW,
    expiresAt: NOW + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR,
    beneficiaryRef: "R-ABCD1234",
    attestation: VALID_ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    },
    clarification: null,
    ...overrides,
  };
}

const MESSAGE = "Pay today and keep this secret";
const URGENCY_START = MESSAGE.indexOf("today");
const URGENCY_END = URGENCY_START + "today".length;
const SECRECY_START = MESSAGE.indexOf("secret");
const SECRECY_END = SECRECY_START + "secret".length;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function liveCouncilPause(): unknown {
  return {
    kind: "live_council",
    assessment: "pause_and_verify",
    corroboratedSignals: [
      {
        id: "secrecy",
        evidence: [
          { id: "secrecy", start: SECRECY_START, end: SECRECY_END, text: "secret" },
          { id: "secrecy", start: SECRECY_START, end: SECRECY_END, text: "secret" },
        ],
      },
    ],
    disputedSignals: [
      {
        id: "urgency",
        reportedBy: "review_a",
        evidence: { id: "urgency", start: URGENCY_START, end: URGENCY_END, text: "today" },
      },
    ],
    questionIds: ["pause_and_ask_trusted_person", "verify_sender_in_known_channel"],
    reviews: [
      { reviewer: "review_a", requestId: "req-a", responseModel: "provider/model-a" },
      { reviewer: "review_b", requestId: "req-b", responseModel: "provider/model-b" },
    ],
  };
}

function liveCouncilNone(): unknown {
  return {
    kind: "live_council",
    assessment: "no_added_signal",
    corroboratedSignals: [],
    disputedSignals: [],
    questionIds: [],
    reviews: [
      { reviewer: "review_a", requestId: "req-a", responseModel: "provider/model-a" },
      { reviewer: "review_b", requestId: "req-b", responseModel: "provider/model-b" },
    ],
  };
}

function partialReview(): unknown {
  return {
    kind: "partial_review",
    assessment: "review_recommended",
    noConsensus: true,
    signals: [
      { id: "urgency", start: URGENCY_START, end: URGENCY_END, text: "today" },
    ],
    questionIds: ["confirm_payment_details"],
    review: { reviewer: "review_a", requestId: "req-a", responseModel: "provider/model-a" },
    unavailableReviewer: "review_b",
  };
}

function localFallback(): unknown {
  return {
    kind: "local_fallback",
    assessment: "review_recommended",
    fallbackReason: "not_configured",
    questionIds: [
      "verify_sender_in_known_channel",
      "confirm_payment_details",
      "pause_and_ask_trusted_person",
    ],
  };
}

function rejected(): unknown {
  return { kind: "rejected", reason: "unverified" };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function openInput() {
  fireEvent.click(screen.getByTestId("family-steward-trigger"));
  await screen.findByTestId("family-steward-message");
}

async function submitMessage(message = MESSAGE) {
  fireEvent.change(screen.getByTestId("family-steward-message"), {
    target: { value: message },
  });
  fireEvent.click(screen.getByTestId("family-steward-submit"));
}

function resolveNext(body: unknown) {
  fetchMock.mockImplementationOnce(async () => jsonResponse(body));
}

describe("FamilyStewardCard — closed state", () => {
  it("renders only the quiet trigger row when closed", () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    expect(screen.getByTestId("family-steward-trigger")).toHaveTextContent(
      "Check a payment message",
    );
    expect(screen.queryByTestId("family-steward-message")).toBeNull();
  });

  it("does not render any model names, request ids, or verdicts when closed", () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/model|request|scam|safe|verified/i);
  });
});

describe("FamilyStewardCard — input state", () => {
  it("opens the textarea, privacy note, and disabled submit on click", async () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    expect(screen.getByTestId("family-steward-message")).toBeInTheDocument();
    expect(screen.getByText(/Only this message reaches the AI reviewers/i)).toBeInTheDocument();
    expect(screen.getByTestId("family-steward-submit")).toBeDisabled();
  });

  it("enables submit once a non-empty message is entered", async () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    fireEvent.change(screen.getByTestId("family-steward-message"), {
      target: { value: "Pay me now" },
    });
    expect(screen.getByTestId("family-steward-submit")).toBeEnabled();
  });

  it("shows the live code-point count and disables submit over 500 code points", async () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    const tooLong = "x".repeat(501);
    fireEvent.change(screen.getByTestId("family-steward-message"), {
      target: { value: tooLong },
    });
    expect(screen.getByTestId("family-steward-count")).toHaveTextContent("501/500");
    expect(screen.getByTestId("family-steward-submit")).toBeDisabled();
  });

  it("never auto-submits — no fetch call while typing", async () => {
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    fireEvent.change(screen.getByTestId("family-steward-message"), {
      target: { value: "Pay me now" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FamilyStewardCard — checking state", () => {
  it("renders a restrained reviewer row without fake completion", async () => {
    resolveNext(liveCouncilNone());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await screen.findByTestId("family-steward-reviewer-0");
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/\b(done|complete|verified|scam|safe|both reviews agreed)\b/i);
  });
});

describe("FamilyStewardCard — live council", () => {
  it("renders the pause headline, exact evidence spans, and questions", async () => {
    resolveNext(liveCouncilPause());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "Pause and verify",
      );
    });
    // Exact evidence spans visibly quoted.
    expect(screen.getByTestId("family-steward-span-secrecy")).toHaveTextContent("secret");
    expect(screen.getByTestId("family-steward-span-urgency")).toHaveTextContent("today");
    // Evidence list quotes the exact text.
    expect(screen.getByTestId("family-steward-evidence-corroborated-secrecy")).toHaveTextContent(
      /both reviews.*“secret”/i,
    );
    expect(screen.getByTestId("family-steward-evidence-disputed-urgency")).toHaveTextContent(
      /one review.*“today”/i,
    );
    // Fixed questions rendered with product text, not raw ids.
    expect(screen.getByTestId("family-steward-question-pause_and_ask_trusted_person")).toHaveTextContent(
      /Pause and check with someone you trust/i,
    );
  });

  it("foregrounds Hold for family review without selecting the path", async () => {
    resolveNext(liveCouncilPause());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await screen.findByTestId("family-steward-hold-hint");
    expect(screen.getByTestId("family-steward-hold-hint")).toHaveTextContent(
      /Hold for family review is available below/i,
    );
    // No wallet, path selection, or blocker change is implied.
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/wallet|selecting|path selected|scam|safe|verified/i);
  });

  it("hides the hold hint on a no-added-signal assessment", async () => {
    resolveNext(liveCouncilNone());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "No added warning signal",
      );
    });
    expect(screen.queryByTestId("family-steward-hold-hint")).toBeNull();
  });

  it("keeps provenance collapsed and out of hero chrome", async () => {
    resolveNext(liveCouncilPause());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await screen.findByTestId("family-steward-headline");
    // Model names live only inside the collapsed provenance disclosure.
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/provider\/model-a|provider\/model-b|req-a|req-b/);
    fireEvent.click(screen.getByTestId("family-steward-provenance-trigger"));
    expect(screen.getByTestId("family-steward-provenance-0")).toHaveTextContent(
      "provider/model-a",
    );
    expect(screen.getByTestId("family-steward-provenance-1")).toHaveTextContent(
      "provider/model-b",
    );
  });

  it("highlights evidence using code-point offsets, not UTF-16 slices", async () => {
    const emojiMessage = "A🙂b keep this secret";
    const codePointIndexOf = (text: string, needle: string) => {
      const chars = Array.from(text);
      const need = Array.from(needle);
      for (let i = 0; i <= chars.length - need.length; i += 1) {
        if (chars.slice(i, i + need.length).join("") === needle) return i;
      }
      return -1;
    };
    const secrecyStart = codePointIndexOf(emojiMessage, "secret");
    const secrecyEnd = secrecyStart + Array.from("secret").length;
    resolveNext({
      kind: "live_council",
      assessment: "pause_and_verify",
      corroboratedSignals: [
        {
          id: "secrecy",
          evidence: [{ id: "secrecy", start: secrecyStart, end: secrecyEnd, text: "secret" }, { id: "secrecy", start: secrecyStart, end: secrecyEnd, text: "secret" }],
        },
      ],
      disputedSignals: [],
      questionIds: ["pause_and_ask_trusted_person"],
      reviews: [
        { reviewer: "review_a", requestId: "req-a", responseModel: "provider/model-a" },
        { reviewer: "review_b", requestId: "req-b", responseModel: "provider/model-b" },
      ],
    });
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage(emojiMessage);
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "Pause and verify",
      );
    });
    expect(screen.getByTestId("family-steward-span-secrecy")).toHaveTextContent("secret");
    expect(screen.getByTestId("family-steward-evidence-message")).toHaveTextContent(
      "A🙂b keep this secret",
    );
  });
});

describe("FamilyStewardCard — partial review", () => {
  it("renders the review-recommended headline and explicit no-consensus copy", async () => {
    resolveNext(partialReview());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "Review recommended",
      );
    });
    expect(screen.getByText(/One review completed/i)).toBeInTheDocument();
    expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
      "Review recommended",
    );
    expect(screen.getByText(/no consensus/i)).toBeInTheDocument();
  });
});

describe("FamilyStewardCard — local fallback", () => {
  it("renders an honest unavailable headline and fixed questions, no fabricated claim", async () => {
    resolveNext(localFallback());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByText(/Live review unavailable/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No consensus is claimed/i)).toBeInTheDocument();
    expect(screen.getByTestId("family-steward-question-verify_sender_in_known_channel")).toBeInTheDocument();
    // No Gonka claim, no model name.
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/gonka|model-a|model-b/i);
  });
});

describe("FamilyStewardCard — rejected", () => {
  it("renders a quote-not-eligible notice and keeps paths usable", async () => {
    resolveNext(rejected());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-rejected")).toHaveTextContent(
        "Quote not eligible for message check",
      );
    });
  });
});

describe("FamilyStewardCard — unavailable / fail closed", () => {
  it("renders the couldn't-complete state when fetch rejects", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "Live review unavailable",
      );
    });
    expect(screen.getByText(/No consensus is claimed/i)).toBeInTheDocument();
  });

  it("fails closed on a malformed response instead of widening the union", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ kind: "live_council", apiKey: "leak" }),
    );
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await waitFor(() => {
      expect(screen.getByTestId("family-steward-headline")).toHaveTextContent(
        "Live review unavailable",
      );
    });
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/leak|apiKey/i);
  });
});

describe("FamilyStewardCard — product language", () => {
  it("never claims scam, safe, verified, or a risk percentage in any state", async () => {
    resolveNext(liveCouncilPause());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await screen.findByTestId("family-steward-headline");
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/scam|safe|verified|\d% risk|risk score/i);
  });

  it("never leaks SDK, debug, or demo jargon", async () => {
    resolveNext(liveCouncilPause());
    render(<FamilyStewardCard quote={baseQuote()} />);
    await openInput();
    await submitMessage();
    await screen.findByTestId("family-steward-headline");
    const card = screen.getByTestId("family-steward-card");
    expect(card.textContent).not.toMatch(/mock|simulation|sdk|v1|v2|debug|hmac|nonce|testnet usdc/i);
  });
});

describe("FamilyStewardCard — Guardian integration", () => {
  it("mounts inside the Guardian card and leaves the Transfer checks trigger usable", () => {
    render(<FamilyGuardianCard quote={baseQuote()} blocker="none" now={NOW} />);
    expect(screen.getByTestId("family-steward-card")).toBeInTheDocument();
    // The deterministic Guardian evidence trigger is still present and functional.
    fireEvent.click(screen.getByTestId("family-guardian-evidence-trigger"));
    expect(screen.getByTestId("family-guardian-check-recipient")).toBeInTheDocument();
  });

  it("does not alter the Guardian headline or blocker state", () => {
    render(<FamilyGuardianCard quote={baseQuote()} blocker="none" now={NOW} />);
    expect(screen.getByTestId("family-guardian-headline")).toHaveTextContent(
      "Ready to review.",
    );
  });
});
