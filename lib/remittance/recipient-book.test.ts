import { describe, expect, it } from "vitest";
import { toBase58 } from "@mysten/sui/utils";
import {
  classifyCandidate,
  parseRecipientRecord,
  RecipientRecordSchema,
  type CandidateDestination,
  type RecipientRecord,
  type RecipientRecordInput,
} from "./recipient-book";

const ADDR_A = "0x" + "ab".repeat(32);
const ADDR_A_UPPER = "0x" + "ab".repeat(32).toUpperCase();
const ADDR_B = "0x" + "22".repeat(32);

// Real Sui transaction digests are base58 of exactly 32 bytes. Build one
// deterministically so the strict digest validator accepts it.
const DIGEST_BYTES = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) & 0xff);
const DIGEST = toBase58(DIGEST_BYTES);
// A syntactically base58-looking but invalid digest: "+" is not in the base58
// alphabet, so isValidTransactionDigest must reject it without throwing.
const FAKE_DIGEST = "++++++++++";

function baseRecord(overrides: Partial<RecipientRecordInput> = {}): RecipientRecordInput {
  return {
    alias: "Mama",
    canonicalAddress: ADDR_A,
    corridorCountry: "Philippines",
    corridorCity: "Manila",
    lastReceiptDigest: null,
    lastReceiptAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateDestination> = {}): CandidateDestination {
  return {
    address: ADDR_A,
    corridorCountry: "Philippines",
    corridorCity: "Manila",
    ...overrides,
  };
}

describe("parseRecipientRecord — strict schema", () => {
  it("accepts a minimal record with null receipt fields", () => {
    const r = parseRecipientRecord(baseRecord());
    expect(r).toEqual({
      alias: "mama",
      canonicalAddress: ADDR_A,
      corridorCountry: "Philippines",
      corridorCity: "Manila",
      lastReceiptDigest: null,
      lastReceiptAt: null,
    });
  });

  it("accepts a record with last receipt evidence", () => {
    const r = parseRecipientRecord(
      baseRecord({ lastReceiptDigest: DIGEST, lastReceiptAt: 1_700_000_000_000 }),
    );
    expect(r?.lastReceiptDigest).toBe(DIGEST);
    expect(r?.lastReceiptAt).toBe(1_700_000_000_000);
  });

  it("rejects an extra key (strict object)", () => {
    const r = parseRecipientRecord({ ...baseRecord(), extra: "nope" } as unknown as RecipientRecordInput);
    expect(r).toBeNull();
  });

  it("rejects a missing required key", () => {
    const r = parseRecipientRecord({ ...baseRecord(), alias: undefined } as unknown as RecipientRecordInput);
    expect(r).toBeNull();
  });

  it("rejects a malformed canonical address", () => {
    const r = parseRecipientRecord(baseRecord({ canonicalAddress: "nope" }));
    expect(r).toBeNull();
  });

  it("rejects a non-canonical address (mixed case not normalized)", () => {
    // Upper-case hex is a valid Sui textual address but not the canonical form
    // this module pins; parseRecipientRecord must reject it rather than silently
    // accept a non-canonical spelling.
    const r = parseRecipientRecord(baseRecord({ canonicalAddress: ADDR_A_UPPER }));
    expect(r).toBeNull();
  });

  it("rejects an empty alias", () => {
    const r = parseRecipientRecord(baseRecord({ alias: "   " }));
    expect(r).toBeNull();
  });

  it("rejects an oversized alias", () => {
    const r = parseRecipientRecord(baseRecord({ alias: "x".repeat(81) }));
    expect(r).toBeNull();
  });

  it("rejects an oversized corridor city/country", () => {
    expect(parseRecipientRecord(baseRecord({ corridorCountry: "x".repeat(81) }))).toBeNull();
    expect(parseRecipientRecord(baseRecord({ corridorCity: "x".repeat(81) }))).toBeNull();
  });

  it("rejects a whitespace-only corridor country", () => {
    expect(parseRecipientRecord(baseRecord({ corridorCountry: "   " }))).toBeNull();
  });

  it("rejects a whitespace-only corridor city", () => {
    expect(parseRecipientRecord(baseRecord({ corridorCity: "   " }))).toBeNull();
  });

  it("trims surrounding whitespace on saved corridor country and city", () => {
    const r = parseRecipientRecord(
      baseRecord({ corridorCountry: "  Philippines  ", corridorCity: "  Manila  " }),
    );
    expect(r?.corridorCountry).toBe("Philippines");
    expect(r?.corridorCity).toBe("Manila");
  });

  it("rejects a malformed last receipt digest (not base58 of 32 bytes)", () => {
    expect(parseRecipientRecord(baseRecord({ lastReceiptDigest: "!!!" }))).toBeNull();
  });

  it("rejects a fake digest that is not in the base58 alphabet", () => {
    // "+" is not a base58 character; the official Sui validator must reject it
    // without throwing. This guards against coarse regex validators that would
    // accept any alphanumeric-ish blob.
    expect(parseRecipientRecord(baseRecord({ lastReceiptDigest: FAKE_DIGEST }))).toBeNull();
  });

  it("rejects a non-safe-integer lastReceiptAt", () => {
    const r = parseRecipientRecord(baseRecord({ lastReceiptAt: Number.MAX_SAFE_INTEGER + 1 }));
    expect(r).toBeNull();
  });

  it("rejects a negative lastReceiptAt", () => {
    const r = parseRecipientRecord(baseRecord({ lastReceiptAt: -1 }));
    expect(r).toBeNull();
  });

  it("rejects a non-object input", () => {
    expect(parseRecipientRecord(null)).toBeNull();
    expect(parseRecipientRecord("nope")).toBeNull();
    expect(parseRecipientRecord([])).toBeNull();
  });
});

describe("parseRecipientRecord — receipt pair atomicity (XOR)", () => {
  it("rejects a digest present with a null timestamp", () => {
    expect(
      parseRecipientRecord(baseRecord({ lastReceiptDigest: DIGEST, lastReceiptAt: null })),
    ).toBeNull();
  });

  it("rejects a timestamp present with a null digest", () => {
    expect(
      parseRecipientRecord(baseRecord({ lastReceiptDigest: null, lastReceiptAt: 1_700_000_000_000 })),
    ).toBeNull();
  });

  it("accepts both null (no prior receipt)", () => {
    const r = parseRecipientRecord(baseRecord());
    expect(r?.lastReceiptDigest).toBeNull();
    expect(r?.lastReceiptAt).toBeNull();
  });

  it("accepts both present (prior receipt evidence)", () => {
    const r = parseRecipientRecord(
      baseRecord({ lastReceiptDigest: DIGEST, lastReceiptAt: 1_700_000_000_000 }),
    );
    expect(r?.lastReceiptDigest).toBe(DIGEST);
    expect(r?.lastReceiptAt).toBe(1_700_000_000_000);
  });
});

describe("parseRecipientRecord — alias normalization", () => {
  it("trims and lowercases the alias deterministically", () => {
    const r = parseRecipientRecord(baseRecord({ alias: "  Mama  " }));
    expect(r?.alias).toBe("mama");
  });

  it("rejects an alias that is empty after trim", () => {
    expect(parseRecipientRecord(baseRecord({ alias: "   " }))).toBeNull();
  });
});

describe("classifyCandidate — first_time", () => {
  it("classifies as first_time when no saved record exists and candidate is valid", () => {
    const result = classifyCandidate(null, candidate());
    expect(result).toEqual({ kind: "first_time", reasons: [] });
  });

  it("classifies as first_time when no saved record exists and candidate is null (absence)", () => {
    const result = classifyCandidate(null, null);
    expect(result).toEqual({ kind: "first_time", reasons: [] });
  });
});

describe("classifyCandidate — known_destination", () => {
  it("classifies as known_destination when address and corridor match exactly", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate());
    expect(result).toEqual({ kind: "known_destination", reasons: [] });
  });

  it("matches a candidate address that is the same Sui address with a different case spelling", () => {
    // The classifier canonicalizes both spellings via normalizeSuiAddress, so a
    // mixed-case candidate spelling resolves to the same canonical address as
    // the saved record.
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ address: ADDR_A_UPPER }));
    expect(result.kind).toBe("known_destination");
  });
});

describe("classifyCandidate — step_up_required", () => {
  it("flags an address change with a deterministic reason", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ address: ADDR_B }));
    expect(result).toEqual({
      kind: "step_up_required",
      reasons: ["address_change"],
    });
  });

  it("flags a country change with a deterministic reason", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ corridorCountry: "Indonesia" }));
    expect(result).toEqual({
      kind: "step_up_required",
      reasons: ["corridor_country_change"],
    });
  });

  it("flags a city change with a deterministic reason", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ corridorCity: "Cebu" }));
    expect(result).toEqual({
      kind: "step_up_required",
      reasons: ["corridor_city_change"],
    });
  });

  it("aggregates multiple change reasons in a fixed order", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(
      record,
      candidate({ address: ADDR_B, corridorCountry: "Indonesia", corridorCity: "Jakarta" }),
    );
    expect(result).toEqual({
      kind: "step_up_required",
      reasons: ["address_change", "corridor_country_change", "corridor_city_change"],
    });
  });
});

describe("classifyCandidate — malformed candidate fails closed (not first_time)", () => {
  it("returns malformed_candidate when a record exists but candidate is null", () => {
    // A null candidate against an existing record cannot be honestly compared;
    // fail closed with an explicit result rather than implying first_time.
    expect(classifyCandidate(parseRecipientRecord(baseRecord()), null)).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate for a candidate with a malformed address", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ address: "nope" }));
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a candidate with an empty country", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ corridorCountry: "" }));
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a candidate with an empty city", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, candidate({ corridorCity: "" }));
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a candidate with an extra key", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, { ...candidate(), extra: "nope" } as unknown as CandidateDestination);
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a candidate with a wrong-typed field", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(record, {
      ...candidate(),
      address: 42,
    } as unknown as CandidateDestination);
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for an oversized candidate corridor field", () => {
    const record = parseRecipientRecord(baseRecord());
    expect(
      classifyCandidate(record, candidate({ corridorCountry: "x".repeat(81) })),
    ).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
    expect(
      classifyCandidate(record, candidate({ corridorCity: "x".repeat(81) })),
    ).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a whitespace-only candidate corridor country", () => {
    const record = parseRecipientRecord(baseRecord());
    expect(
      classifyCandidate(record, candidate({ corridorCountry: "   " })),
    ).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate for a whitespace-only candidate corridor city", () => {
    const record = parseRecipientRecord(baseRecord());
    expect(
      classifyCandidate(record, candidate({ corridorCity: "   " })),
    ).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("trims surrounding whitespace on candidate corridor fields before comparison", () => {
    const record = parseRecipientRecord(baseRecord());
    const result = classifyCandidate(
      record,
      candidate({ corridorCountry: "  Philippines  ", corridorCity: "  Manila  " }),
    );
    expect(result).toEqual({ kind: "known_destination", reasons: [] });
  });

  it("classifies equivalent saved/candidate corridors identically regardless of surrounding whitespace", () => {
    // Symmetry: a saved record stored with surrounding whitespace and a candidate
    // with surrounding whitespace (or none) must classify the same as the trimmed
    // baseline, because both sides share one schema-owned trim+nonblank policy.
    const recordPadded = parseRecipientRecord(
      baseRecord({ corridorCountry: " Philippines ", corridorCity: " Manila " }),
    )!;
    const baseline = classifyCandidate(
      parseRecipientRecord(baseRecord())!,
      candidate({ corridorCountry: "Philippines", corridorCity: "Manila" }),
    );
    const paddedCand = classifyCandidate(
      recordPadded,
      candidate({ corridorCountry: "  Philippines  ", corridorCity: "  Manila  " }),
    );
    const mixedPadded = classifyCandidate(
      recordPadded,
      candidate({ corridorCountry: "Philippines", corridorCity: "Manila" }),
    );
    expect(paddedCand).toEqual(baseline);
    expect(mixedPadded).toEqual(baseline);
    expect(paddedCand.kind).toBe("known_destination");
  });

  it("returns malformed_candidate for a malformed candidate even when no record exists", () => {
    // Corrupt input must fail closed regardless of whether a record exists;
    // it must never be conflated with first_time.
    expect(classifyCandidate(null, { ...candidate(), extra: "nope" } as unknown as CandidateDestination)).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
    expect(classifyCandidate(null, candidate({ address: "nope" }))).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });
});

describe("classifyCandidate — determinism", () => {
  it("produces identical output across repeated calls", () => {
    const record = parseRecipientRecord(baseRecord())!;
    const c = candidate({ address: ADDR_B, corridorCity: "Cebu" });
    const a = classifyCandidate(record, c);
    const b = classifyCandidate(record, c);
    expect(a).toEqual(b);
  });
});

describe("classifyCandidate — mutation safety", () => {
  it("does not mutate the saved record or candidate", () => {
    const record = parseRecipientRecord(baseRecord())!;
    const c = candidate({ address: ADDR_B });
    const recordSnapshot = JSON.parse(JSON.stringify(record)) as typeof record;
    const candSnapshot = JSON.parse(JSON.stringify(c)) as typeof c;
    classifyCandidate(record, c);
    expect(record).toEqual(recordSnapshot);
    expect(c).toEqual(candSnapshot);
  });
});

describe("parseRecipientRecord — never throws on arbitrary input", () => {
  it("does not throw on values that could break a coarse validator", () => {
    const hostile: unknown[] = [
      { ...baseRecord(), lastReceiptDigest: 123 },
      { ...baseRecord(), lastReceiptAt: "1" },
      { ...baseRecord(), canonicalAddress: { not: "a string" } },
      Symbol("x"),
      () => {},
      new Map(),
      Buffer.from("x"),
    ];
    for (const v of hostile) {
      expect(() => parseRecipientRecord(v)).not.toThrow();
    }
  });
});

describe("classifyCandidate — fail-closed result mutation isolation", () => {
  it("a caller mutating a malformed_candidate result's reasons cannot poison a later call", () => {
    const record = parseRecipientRecord(baseRecord())!;
    const first = classifyCandidate(record, null);
    expect(first).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
    // Hostile caller mutates the returned reasons array.
    (first.reasons as string[]).push("poison");
    (first.reasons as string[]).unshift("poison2");
    // A later fail-closed call must still return the pristine single reason.
    const later = classifyCandidate(record, candidate({ address: "nope" }));
    expect(later).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
    expect(later.reasons).toEqual(["malformed_candidate"]);
    expect(later.reasons).toHaveLength(1);
  });

  it("two independent malformed_candidate results are not the same object reference", () => {
    const record = parseRecipientRecord(baseRecord())!;
    const a = classifyCandidate(record, null);
    const b = classifyCandidate(record, candidate({ address: "nope" }));
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.reasons).not.toBe(b.reasons);
  });

  it("mutating one malformed_candidate result does not change a concurrently captured snapshot", () => {
    const record = parseRecipientRecord(baseRecord())!;
    const a = classifyCandidate(record, null);
    const snapshot = JSON.parse(JSON.stringify(a)) as typeof a;
    (a.reasons as string[]).push("poison");
    const b = classifyCandidate(record, null);
    expect(b).toEqual(snapshot);
  });
});

describe("RecipientRecordSchema — encodes canonical invariants (z.output trusted)", () => {
  it("rejects a non-canonical address at schema level", () => {
    expect(RecipientRecordSchema.safeParse(baseRecord({ canonicalAddress: ADDR_A_UPPER })).success).toBe(false);
  });
  it("rejects an invalid digest at schema level", () => {
    expect(
      RecipientRecordSchema.safeParse(
        baseRecord({ lastReceiptDigest: FAKE_DIGEST, lastReceiptAt: 1_700_000_000_000 }),
      ).success,
    ).toBe(false);
  });
  it("rejects a broken receipt pair (digest present, timestamp null) at schema level", () => {
    expect(
      RecipientRecordSchema.safeParse(baseRecord({ lastReceiptDigest: DIGEST, lastReceiptAt: null })).success,
    ).toBe(false);
  });
  it("rejects an extra key at schema level", () => {
    expect(RecipientRecordSchema.safeParse({ ...baseRecord(), extra: "nope" }).success).toBe(false);
  });
  it("normalizes alias (trim + lowercase) at schema level", () => {
    const r = RecipientRecordSchema.safeParse(baseRecord({ alias: "  Mama  " }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.alias).toBe("mama");
  });
});

describe("classifyCandidate — revalidates saved record (fail closed on corrupt record)", () => {
  it("returns malformed_candidate when record has an extra key", () => {
    const corrupt = { ...baseRecord(), extra: "nope" } as unknown as RecipientRecord;
    expect(classifyCandidate(corrupt, candidate())).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate when record has an invalid receipt pair", () => {
    const corrupt = {
      ...baseRecord(),
      lastReceiptDigest: DIGEST,
      lastReceiptAt: null,
    } as unknown as RecipientRecord;
    expect(classifyCandidate(corrupt, candidate())).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate when record has an invalid digest", () => {
    const corrupt = {
      ...baseRecord(),
      lastReceiptDigest: FAKE_DIGEST,
      lastReceiptAt: 1_700_000_000_000,
    } as unknown as RecipientRecord;
    expect(classifyCandidate(corrupt, candidate())).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate when record has a non-canonical address", () => {
    const corrupt = { ...baseRecord(), canonicalAddress: ADDR_A_UPPER } as unknown as RecipientRecord;
    expect(classifyCandidate(corrupt, candidate())).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("never returns known_destination when a corrupt record would otherwise match the candidate", () => {
    // Candidate matches the corrupt record's fields exactly, but the corrupt
    // record must fail closed rather than be trusted as a known destination.
    const corrupt = { ...baseRecord(), extra: "nope" } as unknown as RecipientRecord;
    const result = classifyCandidate(corrupt, candidate());
    expect(result.kind).not.toBe("known_destination");
    expect(result).toEqual({ kind: "malformed_candidate", reasons: ["malformed_candidate"] });
  });

  it("returns malformed_candidate when a corrupt record is paired with a null candidate", () => {
    const corrupt = { ...baseRecord(), extra: "nope" } as unknown as RecipientRecord;
    expect(classifyCandidate(corrupt, null)).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate when record is a forged object with wrong-typed fields", () => {
    const forged = { ...baseRecord(), canonicalAddress: 42 } as unknown as RecipientRecord;
    expect(classifyCandidate(forged, candidate())).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });
});

describe("classifyCandidate — bounds candidate address before normalization", () => {
  it("returns malformed_candidate for an oversized hostile address string", () => {
    const record = parseRecipientRecord(baseRecord());
    const hostile = "0x" + "a".repeat(10_000);
    expect(classifyCandidate(record, candidate({ address: hostile }))).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate for a non-hex-shaped address", () => {
    const record = parseRecipientRecord(baseRecord());
    expect(classifyCandidate(record, candidate({ address: "0xZZZZ" }))).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });

  it("returns malformed_candidate for an oversized hostile address even with no record", () => {
    const hostile = "0x" + "a".repeat(10_000);
    expect(classifyCandidate(null, candidate({ address: hostile }))).toEqual({
      kind: "malformed_candidate",
      reasons: ["malformed_candidate"],
    });
  });
});
