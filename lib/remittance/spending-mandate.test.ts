import { describe, expect, it } from "vitest";
import {
  evaluateMandate,
  parseSpendingMandate,
  SpendingMandateSchema,
  type MandateEvaluationRequest,
  type SpendingMandateInput,
} from "./spending-mandate";

const ADDR_A = "0x" + "ab".repeat(32);
const ADDR_A_UPPER = "0x" + "ab".repeat(32).toUpperCase();
const ADDR_B = "0x" + "22".repeat(32);

const NOW = 1_700_000_000_000;
const START = NOW - 60_000;
const END = NOW + 60_000;

function baseMandate(overrides: Partial<SpendingMandateInput> = {}): SpendingMandateInput {
  return {
    recipientAddress: ADDR_A,
    purpose: "Family support",
    category: "remittance",
    perPaymentMicroMax: "100000000", // 100 USDC
    destinationCountry: "Philippines",
    startAt: START,
    endAt: END,
    enabled: true,
    revokedAt: null,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<MandateEvaluationRequest> = {}): MandateEvaluationRequest {
  return {
    recipientAddress: ADDR_A,
    amountMicro: "50000000", // 50 USDC
    destinationCountry: "Philippines",
    category: "remittance",
    purpose: "Family support",
    now: NOW,
    ...overrides,
  };
}

describe("parseSpendingMandate — strict schema", () => {
  it("accepts a minimal enabled mandate", () => {
    const m = parseSpendingMandate(baseMandate());
    expect(m).toEqual({
      recipientAddress: ADDR_A,
      purpose: "Family support",
      category: "remittance",
      perPaymentMicroMax: "100000000",
      destinationCountry: "Philippines",
      startAt: START,
      endAt: END,
      enabled: true,
      revokedAt: null,
    });
  });

  it("accepts a revoked mandate with a timestamp", () => {
    const m = parseSpendingMandate(
      baseMandate({ enabled: false, revokedAt: NOW - 1_000 }),
    );
    expect(m?.enabled).toBe(false);
    expect(m?.revokedAt).toBe(NOW - 1_000);
  });

  it("rejects an extra key (strict object)", () => {
    const m = parseSpendingMandate({ ...baseMandate(), extra: "nope" } as unknown as SpendingMandateInput);
    expect(m).toBeNull();
  });

  it("rejects a missing required key", () => {
    const m = parseSpendingMandate({ ...baseMandate(), purpose: undefined } as unknown as SpendingMandateInput);
    expect(m).toBeNull();
  });

  it("rejects a malformed recipient address", () => {
    expect(parseSpendingMandate(baseMandate({ recipientAddress: "nope" }))).toBeNull();
  });

  it("rejects a non-canonical (mixed-case) recipient address", () => {
    expect(parseSpendingMandate(baseMandate({ recipientAddress: ADDR_A_UPPER }))).toBeNull();
  });

  it("rejects a malformed per-payment maximum (non-integer string)", () => {
    expect(parseSpendingMandate(baseMandate({ perPaymentMicroMax: "1.5" }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ perPaymentMicroMax: "abc" }))).toBeNull();
  });

  it("rejects a negative per-payment maximum", () => {
    expect(parseSpendingMandate(baseMandate({ perPaymentMicroMax: "-1" }))).toBeNull();
  });

  it("rejects a zero per-payment maximum", () => {
    expect(parseSpendingMandate(baseMandate({ perPaymentMicroMax: "0" }))).toBeNull();
  });

  it("rejects an oversized per-payment maximum", () => {
    expect(parseSpendingMandate(baseMandate({ perPaymentMicroMax: "9".repeat(21) }))).toBeNull();
  });

  it("rejects an oversized purpose/category/country", () => {
    expect(parseSpendingMandate(baseMandate({ purpose: "x".repeat(121) }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ category: "x".repeat(41) }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ destinationCountry: "x".repeat(81) }))).toBeNull();
  });

  it("rejects a non-safe-integer startAt/endAt", () => {
    expect(parseSpendingMandate(baseMandate({ startAt: Number.MAX_SAFE_INTEGER + 1 }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ endAt: Number.MAX_SAFE_INTEGER + 1 }))).toBeNull();
  });

  it("rejects a negative startAt/endAt", () => {
    expect(parseSpendingMandate(baseMandate({ startAt: -1 }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ endAt: -1 }))).toBeNull();
  });

  it("rejects a revokedAt that is not a safe non-negative integer when present", () => {
    expect(parseSpendingMandate(baseMandate({ revokedAt: -1 }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ revokedAt: Number.MAX_SAFE_INTEGER + 1 }))).toBeNull();
  });

  it("rejects a non-object input", () => {
    expect(parseSpendingMandate(null)).toBeNull();
    expect(parseSpendingMandate("nope")).toBeNull();
    expect(parseSpendingMandate([])).toBeNull();
  });
});

describe("evaluateMandate — allowed", () => {
  it("allows a fully matching in-window in-amount request", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest());
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("allows when amount equals the maximum exactly (boundary)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "100000000" }));
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("allows when now equals startAt exactly (boundary)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ now: START }));
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("allows when now equals endAt exactly (boundary inclusive)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ now: END }));
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("allows a candidate address spelled in mixed case (canonicalized)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ recipientAddress: ADDR_A_UPPER }));
    expect(result.kind).toBe("allowed");
  });
});

describe("evaluateMandate — stopped (revoked)", () => {
  it("stops with revoked when the mandate is disabled", () => {
    const m = parseSpendingMandate(baseMandate({ enabled: false, revokedAt: NOW - 1_000 }))!;
    const result = evaluateMandate(m, baseRequest());
    expect(result).toEqual({ kind: "stopped", reasons: ["revoked"] });
  });
});

describe("evaluateMandate — stopped (window)", () => {
  it("stops with expired when now is after endAt", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ now: END + 1 }));
    expect(result).toEqual({ kind: "stopped", reasons: ["expired"] });
  });

  it("stops with not_yet_valid when now is before startAt", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ now: START - 1 }));
    expect(result).toEqual({ kind: "stopped", reasons: ["not_yet_valid"] });
  });
});

describe("evaluateMandate — stopped (recipient/country/category/amount)", () => {
  it("stops with recipient_mismatch on a different address", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ recipientAddress: ADDR_B }));
    expect(result).toEqual({ kind: "stopped", reasons: ["recipient_mismatch"] });
  });

  it("stops with country_mismatch on a different country", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ destinationCountry: "Indonesia" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["country_mismatch"] });
  });

  it("stops with category_mismatch on a different category", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ category: "commerce" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["category_mismatch"] });
  });

  it("stops with amount_exceeds when amount is above the maximum", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "100000001" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["amount_exceeds"] });
  });
});

describe("evaluateMandate — stopped precedence", () => {
  it("revoked takes precedence over every other mismatch", () => {
    const m = parseSpendingMandate(
      baseMandate({ enabled: false, revokedAt: NOW - 1_000 }),
    )!;
    const result = evaluateMandate(
      m,
      baseRequest({ recipientAddress: ADDR_B, amountMicro: "999999999", destinationCountry: "Indonesia" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["revoked"] });
  });

  it("window expiry takes precedence over recipient/amount mismatch", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ now: END + 1, recipientAddress: ADDR_B, amountMicro: "999999999" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["expired"] });
  });

  it("not_yet_valid takes precedence over recipient/amount mismatch", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ now: START - 1, recipientAddress: ADDR_B, amountMicro: "999999999" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["not_yet_valid"] });
  });

  it("recipient mismatch takes precedence over amount exceeds", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ recipientAddress: ADDR_B, amountMicro: "999999999" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["recipient_mismatch"] });
  });

  it("country mismatch takes precedence over amount exceeds", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ destinationCountry: "Indonesia", amountMicro: "999999999" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["country_mismatch"] });
  });

  it("category mismatch takes precedence over amount exceeds", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ category: "commerce", amountMicro: "999999999" }),
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["category_mismatch"] });
  });
});

describe("evaluateMandate — malformed request fails closed", () => {
  it("stops with malformed when amount is not an integer string", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "1.5" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when amount is negative", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "-1" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when amount is zero", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "0" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when amount is an oversized integer string", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "9".repeat(21) }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when recipient address is invalid", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ recipientAddress: "nope" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when now is not a safe integer", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ now: Number.MAX_SAFE_INTEGER + 1 }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when country or category is empty", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, baseRequest({ destinationCountry: "" }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
    expect(evaluateMandate(m, baseRequest({ category: "" }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });

  it("stops with malformed when request is null", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, null)).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when request has an extra key (strict object)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, { ...baseRequest(), extra: "nope" } as unknown as MandateEvaluationRequest);
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when request has a wrong-typed field", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, {
      ...baseRequest(),
      amountMicro: 42,
    } as unknown as MandateEvaluationRequest);
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });
});

describe("evaluateMandate — purpose default fail closed", () => {
  it("stops with purpose_mismatch by default when purpose differs (never allowed)", () => {
    // Default policy: a purpose mismatch is a stop, not an allowed pass and not
    // a review trigger. Only an explicit bounded policy may yield needs_review.
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "Different text" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["purpose_mismatch"] });
  });

  it("stops with malformed when purpose is missing", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: undefined } as unknown as MandateEvaluationRequest));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when purpose is a non-string", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: 42 } as unknown as MandateEvaluationRequest));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when purpose is an empty string", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when purpose is oversized", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "x".repeat(121) }));
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });
});

describe("evaluateMandate — needs_review only with explicit bounded policy", () => {
  it("returns needs_review with purpose_mismatch when review is enabled and purpose differs", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "Different text" }), {
      allowReviewOnPurposeMismatch: true,
    });
    expect(result).toEqual({ kind: "needs_review", reasons: ["purpose_mismatch"] });
  });

  it("stops with purpose_mismatch when review flag is explicitly false", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "Different text" }), {
      allowReviewOnPurposeMismatch: false,
    });
    expect(result).toEqual({ kind: "stopped", reasons: ["purpose_mismatch"] });
  });

  it("stops with malformed when policy has an extra key (strict object)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ purpose: "Different text" }),
      { allowReviewOnPurposeMismatch: true, extra: "nope" } as unknown as Parameters<typeof evaluateMandate>[2],
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when policy flag is a wrong type", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({ purpose: "Different text" }),
      { allowReviewOnPurposeMismatch: "yes" } as unknown as Parameters<typeof evaluateMandate>[2],
    );
    expect(result).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });
});

describe("evaluateMandate — revalidates non-null mandate and never throws", () => {
  it("stops with malformed when a non-null mandate fails revalidation (extra key)", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const tampered = { ...m, extra: "nope" } as unknown as typeof m;
    expect(evaluateMandate(tampered, baseRequest())).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when a non-null mandate has a wrong-typed field", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const tampered = { ...m, enabled: "true" } as unknown as typeof m;
    expect(evaluateMandate(tampered, baseRequest())).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("stops with malformed when mandate is null", () => {
    expect(evaluateMandate(null, baseRequest())).toEqual({ kind: "stopped", reasons: ["malformed"] });
  });

  it("never throws on arbitrary hostile mandate/request/policy inputs", () => {
    const hostile: Array<[unknown, unknown, unknown]> = [
      [Symbol("x"), baseRequest(), {}],
      [{ ...baseMandate(), perPaymentMicroMax: BigInt(1) }, baseRequest(), {}],
      [() => {}, baseRequest(), {}],
      [parseSpendingMandate(baseMandate())!, { ...baseRequest(), now: BigInt(1) }, {}],
      [parseSpendingMandate(baseMandate())!, baseRequest(), Symbol("p")],
      [new Map(), baseRequest(), {}],
    ];
    for (const [mandate, request, policy] of hostile) {
      expect(() => evaluateMandate(mandate as never, request as never, policy as never)).not.toThrow();
    }
  });
});

describe("evaluateMandate — BigInt string boundaries", () => {
  it("compares a large amount against a large maximum without floating point", () => {
    const m = parseSpendingMandate(
      baseMandate({ perPaymentMicroMax: "9007199254740993" }), // > MAX_SAFE_INTEGER
    )!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "9007199254740993" }));
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("rejects an off-by-one surplus on a large maximum", () => {
    const m = parseSpendingMandate(
      baseMandate({ perPaymentMicroMax: "9007199254740993" }),
    )!;
    const result = evaluateMandate(m, baseRequest({ amountMicro: "9007199254740994" }));
    expect(result).toEqual({ kind: "stopped", reasons: ["amount_exceeds"] });
  });
});

describe("evaluateMandate — determinism + mutation safety", () => {
  it("produces identical output across repeated calls", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const req = baseRequest({ recipientAddress: ADDR_B });
    const a = evaluateMandate(m, req);
    const b = evaluateMandate(m, req);
    expect(a).toEqual(b);
  });

  it("does not mutate the mandate or request", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const req = baseRequest({ amountMicro: "999999999" });
    const mSnap = JSON.parse(JSON.stringify(m)) as typeof m;
    const reqSnap = JSON.parse(JSON.stringify(req)) as typeof req;
    evaluateMandate(m, req);
    expect(m).toEqual(mSnap);
    expect(req).toEqual(reqSnap);
  });
});

describe("evaluateMandate — fail-closed result mutation isolation", () => {
  it("a caller mutating a stopped/malformed result's reasons cannot poison a later call", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const first = evaluateMandate(null, baseRequest());
    expect(first).toEqual({ kind: "stopped", reasons: ["malformed"] });
    // Hostile caller mutates the returned reasons array.
    (first.reasons as string[]).push("poison");
    (first.reasons as string[]).unshift("poison2");
    // A later fail-closed call must still return the pristine single reason.
    const later = evaluateMandate(m, null);
    expect(later).toEqual({ kind: "stopped", reasons: ["malformed"] });
    expect(later.reasons).toEqual(["malformed"]);
    expect(later.reasons).toHaveLength(1);
  });

  it("two independent fail-closed results are not the same object reference", () => {
    const a = evaluateMandate(null, baseRequest());
    const b = evaluateMandate(parseSpendingMandate(baseMandate())!, null);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.reasons).not.toBe(b.reasons);
  });

  it("mutating one fail-closed result does not change a concurrently captured snapshot", () => {
    const a = evaluateMandate(null, baseRequest());
    const snapshot = JSON.parse(JSON.stringify(a)) as typeof a;
    (a.reasons as string[]).push("poison");
    const b = evaluateMandate(null, baseRequest());
    expect(b).toEqual(snapshot);
  });
});

describe("SpendingMandateSchema — encodes canonical invariants (z.output trusted)", () => {
  it("rejects a non-canonical recipient address at schema level", () => {
    expect(SpendingMandateSchema.safeParse(baseMandate({ recipientAddress: ADDR_A_UPPER })).success).toBe(false);
  });
  it("rejects endAt < startAt at schema level", () => {
    expect(SpendingMandateSchema.safeParse(baseMandate({ startAt: END, endAt: START })).success).toBe(false);
  });
  it("rejects an enabled mandate with a revokedAt timestamp at schema level", () => {
    expect(SpendingMandateSchema.safeParse(baseMandate({ enabled: true, revokedAt: NOW - 1_000 })).success).toBe(false);
  });
  it("rejects a disabled mandate with a null revokedAt at schema level", () => {
    expect(SpendingMandateSchema.safeParse(baseMandate({ enabled: false, revokedAt: null })).success).toBe(false);
  });
  it("rejects an extra key at schema level", () => {
    expect(SpendingMandateSchema.safeParse({ ...baseMandate(), extra: "nope" }).success).toBe(false);
  });
});

describe("parseSpendingMandate — rejects whitespace-only scope dimensions", () => {
  it("rejects a whitespace-only purpose", () => {
    expect(parseSpendingMandate(baseMandate({ purpose: "   " }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ purpose: "\t\n" }))).toBeNull();
  });

  it("rejects a whitespace-only category", () => {
    expect(parseSpendingMandate(baseMandate({ category: "   " }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ category: "\t" }))).toBeNull();
  });

  it("rejects a whitespace-only destinationCountry", () => {
    expect(parseSpendingMandate(baseMandate({ destinationCountry: "   " }))).toBeNull();
    expect(parseSpendingMandate(baseMandate({ destinationCountry: "\n" }))).toBeNull();
  });
});

describe("parseSpendingMandate — normalizes surrounding whitespace on scope dimensions", () => {
  it("trims surrounding whitespace on purpose", () => {
    const m = parseSpendingMandate(baseMandate({ purpose: "  Family support  " }));
    expect(m?.purpose).toBe("Family support");
  });

  it("trims surrounding whitespace on category", () => {
    const m = parseSpendingMandate(baseMandate({ category: "\tremittance\n" }));
    expect(m?.category).toBe("remittance");
  });

  it("trims surrounding whitespace on destinationCountry", () => {
    const m = parseSpendingMandate(baseMandate({ destinationCountry: " Philippines " }));
    expect(m?.destinationCountry).toBe("Philippines");
  });

  it("preserves internal whitespace after trimming", () => {
    const m = parseSpendingMandate(baseMandate({ purpose: "  Family support monthly  " }));
    expect(m?.purpose).toBe("Family support monthly");
  });
});

describe("evaluateMandate — rejects whitespace-only request scope dimensions", () => {
  it("stops with malformed when request purpose is whitespace-only", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, baseRequest({ purpose: "   " }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });

  it("stops with malformed when request category is whitespace-only", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, baseRequest({ category: "\t" }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });

  it("stops with malformed when request destinationCountry is whitespace-only", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, baseRequest({ destinationCountry: "  " }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });
});

describe("evaluateMandate — normalizes request scope whitespace and stays deterministic", () => {
  it("allows when request scope fields carry surrounding whitespace that trims to the mandate values", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(
      m,
      baseRequest({
        purpose: "  Family support  ",
        category: " remittance ",
        destinationCountry: " Philippines ",
      }),
    );
    expect(result).toEqual({ kind: "allowed", reasons: [] });
  });

  it("still stops with country_mismatch when trimmed request country differs", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ destinationCountry: "  Indonesia  " }));
    expect(result).toEqual({ kind: "stopped", reasons: ["country_mismatch"] });
  });

  it("still stops with category_mismatch when trimmed request category differs", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ category: "  commerce  " }));
    expect(result).toEqual({ kind: "stopped", reasons: ["category_mismatch"] });
  });

  it("still stops with purpose_mismatch when trimmed request purpose differs", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const result = evaluateMandate(m, baseRequest({ purpose: "  Different  " }));
    expect(result).toEqual({ kind: "stopped", reasons: ["purpose_mismatch"] });
  });

  it("produces identical output across repeated calls with whitespace-padded inputs", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const req = baseRequest({ purpose: "  Family support  " });
    const a = evaluateMandate(m, req);
    const b = evaluateMandate(m, req);
    expect(a).toEqual(b);
  });
});

describe("evaluateMandate — bounds request recipient address before normalization", () => {
  it("stops with malformed for an oversized hostile address string", () => {
    const m = parseSpendingMandate(baseMandate())!;
    const hostile = "0x" + "a".repeat(10_000);
    expect(evaluateMandate(m, baseRequest({ recipientAddress: hostile }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });

  it("stops with malformed for a non-hex-shaped address", () => {
    const m = parseSpendingMandate(baseMandate())!;
    expect(evaluateMandate(m, baseRequest({ recipientAddress: "0xZZZZ" }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });

  it("stops with malformed for an oversized hostile address even when mandate is null", () => {
    const hostile = "0x" + "a".repeat(10_000);
    expect(evaluateMandate(null, baseRequest({ recipientAddress: hostile }))).toEqual({
      kind: "stopped",
      reasons: ["malformed"],
    });
  });
});
