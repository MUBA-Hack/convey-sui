import { describe, expect, it } from "vitest";
import {
  resolveGonkaRemittanceCandidate,
  MIN_REMITTANCE_CONFIDENCE,
} from "@/lib/remittance/gonka-resolver";
import type {
  GonkaRemittanceCandidate,
  GonkaRemittanceManifest,
} from "@/lib/gonka/remittance";

const GOLDEN_PROMPT = "Hantar RM500 to Ana for school supplies; jangan lebih RM520.";

const MANIFEST: GonkaRemittanceManifest = {
  recipients: [
    { alias: "Ana", destinationCities: ["Manila"], destinationCountry: "Philippines" },
    { alias: "Maria", destinationCities: ["Cebu", "Quezon City"], destinationCountry: "Philippines" },
  ],
  corridor: {
    source: "MYR",
    destination: "PHP",
    destinationCountry: "Philippines",
    destinationCities: ["manila", "cebu", "quezon city"],
  },
};

function candidate(overrides: Partial<GonkaRemittanceCandidate> = {}): GonkaRemittanceCandidate {
  return {
    recipientAlias: "Ana",
    destinationCity: "Manila",
    destinationCountry: "Philippines",
    sendAmountMyr: "500",
    purpose: "school supplies",
    maxAmountMyr: "520",
    detectedLanguage: "ms",
    explanation: "User wants to send RM500 to Ana in Manila for school supplies.",
    confidence: 0.92,
    uncertain: false,
    needsReview: false,
    ...overrides,
  };
}

describe("resolveGonkaRemittanceCandidate — golden mixed-language request", () => {
  it("resolves RM500, Ana, Manila, purpose school supplies, max RM520", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate(), MANIFEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.action).toBe("send");
    expect(r.intent.amountMinor).toBe("50000");
    expect(r.intent.currency).toBe("MYR");
    expect(r.intent.recipient).toBe("Ana");
    expect(r.intent.destinationCity).toBe("manila");
    expect(r.intent.destinationCountry).toBe("Philippines");
    expect(r.intent.purpose).toBe("school supplies");
    expect(r.intent.maxAmountMinor).toBe("52000");
    expect(r.intent.confidence).toBe(0.92);
  });

  it("rebinds the destination city to the canonical corridor alias", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM250 to Maria in Quezon City",
      candidate({
        recipientAlias: "Maria",
        destinationCity: "Quezon City",
        sendAmountMyr: "250",
        purpose: undefined,
        maxAmountMyr: undefined,
      }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.recipient).toBe("Maria");
    expect(r.intent.destinationCity).toBe("quezon city");
    expect(r.intent.purpose).toBeNull();
    expect(r.intent.maxAmountMinor).toBeNull();
  });
});

describe("resolveGonkaRemittanceCandidate — candidate mismatch fails closed", () => {
  it("fails closed on amount mismatch", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ sendAmountMyr: "600" }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("amount_mismatch");
  });

  it("fails closed on recipient mismatch", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ recipientAlias: "Maria" }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("recipient_mismatch");
  });

  it("fails closed on city mismatch (city not listed for recipient)", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ destinationCity: "Cebu" }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("city_mismatch");
  });

  it("fails closed on currency mismatch (non-MYR source text)", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send USD500 to Ana in Manila",
      candidate(),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("currency_mismatch");
  });

  it("fails closed when the candidate city is outside the supported corridor", () => {
    const manifest: GonkaRemittanceManifest = {
      recipients: [
        { alias: "Ana", destinationCities: ["Tokyo"], destinationCountry: "Philippines" },
      ],
      corridor: {
        source: "MYR",
        destination: "PHP",
        destinationCountry: "Philippines",
        destinationCities: ["manila", "cebu"],
      },
    };
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Tokyo",
      candidate({ destinationCity: "Tokyo" }),
      manifest,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsupported_corridor");
  });
});

describe("resolveGonkaRemittanceCandidate — cap policy", () => {
  it("fails closed when the cap is below the send amount", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Hantar RM500 to Ana jangan lebih RM400",
      candidate({ maxAmountMyr: "400", purpose: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cap_below_amount");
  });

  it("fails closed when the candidate cap disagrees with the text cap", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ maxAmountMyr: "600" }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cap_mismatch");
  });
});

describe("resolveGonkaRemittanceCandidate — model uncertainty / confidence", () => {
  it("requires clarification when the candidate is uncertain", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ uncertain: true }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("model_uncertain");
  });

  it("requires clarification when the candidate flags needsReview", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate({ needsReview: true }), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("needs_review");
  });

  it(`requires clarification when confidence is below ${MIN_REMITTANCE_CONFIDENCE}`, () => {
    const r = resolveGonkaRemittanceCandidate(
      GOLDEN_PROMPT,
      candidate({ confidence: MIN_REMITTANCE_CONFIDENCE - 0.01 }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("low_confidence");
  });
});

describe("resolveGonkaRemittanceCandidate — unknown recipient / missing fields", () => {
  it("fails closed when the candidate recipient is not in the manifest", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Bob in Manila",
      candidate({ recipientAlias: "Bob" }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown_recipient");
  });

  it("fails closed when the original text has no amount", () => {
    const r = resolveGonkaRemittanceCandidate("Hantar to Ana in Manila", candidate(), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_amount");
  });

  it("fails closed when the original text has no recipient", () => {
    const r = resolveGonkaRemittanceCandidate("Hantar RM500 in Manila", candidate(), MANIFEST);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_recipient");
  });
});

describe("resolveGonkaRemittanceCandidate — no authority from candidate", () => {
  it("never carries a wallet address or execution authority on a resolved intent", () => {
    const r = resolveGonkaRemittanceCandidate(GOLDEN_PROMPT, candidate(), MANIFEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.intent);
    expect(serialized.toLowerCase()).not.toContain("address");
    expect(serialized.toLowerCase()).not.toContain("signature");
    expect(serialized.toLowerCase()).not.toContain("digest");
    expect(serialized.toLowerCase()).not.toContain("transaction");
  });
});

describe("resolveGonkaRemittanceCandidate — destination rebind", () => {
  it("fails closed when the original states Cebu but the candidate says Quezon City", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM250 to Maria in Cebu",
      candidate({
        recipientAlias: "Maria",
        destinationCity: "Quezon City",
        sendAmountMyr: "250",
        purpose: undefined,
        maxAmountMyr: undefined,
      }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("city_mismatch");
  });

  it("resolves when the original states Cebu and the candidate matches Cebu", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM250 to Maria in Cebu",
      candidate({
        recipientAlias: "Maria",
        destinationCity: "Cebu",
        sendAmountMyr: "250",
        purpose: undefined,
        maxAmountMyr: undefined,
      }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.destinationCity).toBe("cebu");
  });

  it("uses the unique city when the original omits a city and the recipient has one", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Hantar RM500 to Ana for school supplies; jangan lebih RM520.",
      candidate(),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.destinationCity).toBe("manila");
  });

  it("fails closed with ambiguous_destination when the original omits a city and the recipient has multiple", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Hantar RM250 kepada Maria untuk buku",
      candidate({
        recipientAlias: "Maria",
        destinationCity: "Cebu",
        sendAmountMyr: "250",
        purpose: "buku",
        maxAmountMyr: undefined,
      }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_destination");
  });

  it("fails closed when the original states an unsupported destination word", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Tokyo",
      candidate({ destinationCity: "Tokyo" }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsupported_corridor");
  });

  it("fails closed when the candidate country does not match the recipient manifest country", () => {
    const manifest: GonkaRemittanceManifest = {
      recipients: [
        { alias: "Ana", destinationCities: ["Manila"], destinationCountry: "Philippines" },
      ],
      corridor: {
        source: "MYR",
        destination: "PHP",
        destinationCountry: "Philippines",
        destinationCities: ["manila"],
      },
    };
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Manila",
      candidate({ destinationCountry: "Japan" }),
      manifest,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("country_mismatch");
  });
});

describe("resolveGonkaRemittanceCandidate — malformed/ambiguous constraints mapped to reasons", () => {
  it("maps a malformed max cap to invalid_cap", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana jangan lebih abc",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_cap");
  });

  it("maps multiple send amounts to ambiguous_amount", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 and RM600 to Ana in Manila",
      candidate(),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_amount");
  });

  it("maps multiple cap clauses to ambiguous_cap", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana jangan lebih RM600 jangan lebih RM700",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_cap");
  });

  it("maps a malformed purpose clause to invalid_purpose", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana for 123 school supplies",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_purpose");
  });

  it("maps ambiguous purpose (for books; for medicine) to ambiguous_purpose", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana for books; for medicine",
      candidate({ purpose: "books", maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous_purpose");
  });

  it("maps a trailing bare purpose marker to invalid_purpose", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana for",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_purpose");
  });

  it("parses max RM1,000 as 1000 minor at the resolver (strict cap grouping)", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana max RM1,000",
      candidate({ purpose: undefined, maxAmountMyr: "1000" }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.maxAmountMinor).toBe("100000");
  });

  it("fails closed at the resolver when the cap has no terminal numeric boundary (max RM500abc)", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana max RM500abc",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_cap");
  });
});

describe("resolveGonkaRemittanceCandidate — explicit original-text country rebind", () => {
  it("fails closed when the original states Manila, Japan even if candidate and manifest say Philippines", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Manila, Japan",
      candidate(),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsupported_corridor");
  });

  it("passes when the original states an explicit Philippines country and all other fields match", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Manila, Philippines",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.destinationCity).toBe("manila");
    expect(r.intent.destinationCountry).toBe("Philippines");
  });

  it("passes when the original states Philippines as the sole destination token", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Philippines",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.destinationCity).toBe("manila");
  });

  it("passes when the original omits a country (uses manifest/corridor country as before)", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Manila",
      candidate({ purpose: undefined, maxAmountMyr: undefined }),
      MANIFEST,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.destinationCountry).toBe("Philippines");
  });

  it("fails closed when the original states an explicit unsupported sole country (in Japan)", () => {
    const r = resolveGonkaRemittanceCandidate(
      "Send RM500 to Ana in Japan",
      candidate({ destinationCity: "Tokyo", destinationCountry: "Japan" }),
      MANIFEST,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsupported_corridor");
  });
});
