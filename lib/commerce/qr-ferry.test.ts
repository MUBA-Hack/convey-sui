import { describe, expect, it } from "vitest";
import { blake2b } from "@noble/hashes/blake2.js";
import {
  ENVELOPE_VERSION,
  InMemoryReplayRegistry,
  MAX_ITEM_LENGTH,
  MAX_NONCE_LENGTH,
  MAX_QUANTITY,
  QrFerryError,
  canonicalEnvelopeEncoding,
  createEnvelope,
  exportEnvelopeJson,
  importEnvelope,
  verifyEnvelope,
  type QrFerryEnvelope,
  type QrFerryEnvelopeInput,
} from "./qr-ferry";

// Deterministic test merchant address (valid Sui address: 32-byte hex, 0x prefix).
const MERCHANT =
  "0x".concat("11".repeat(32)) as `0x${string}`;
const PAYER =
  "0x".concat("22".repeat(32)) as `0x${string}`;
const NOW = 1_700_000_000_000; // fixed "now" for deterministic tests

function baseInput(overrides: Partial<QrFerryEnvelopeInput> = {}): QrFerryEnvelopeInput {
  return {
    item: "Iced Coffee",
    quantity: 2,
    totalMist: 1_500_000_000n, // 1.5 SUI
    merchantAddress: MERCHANT,
    nonce: "nonce-abc-001",
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

describe("qr-ferry envelope — round trip", () => {
  it("round-trips a valid envelope and verifies checksum", () => {
    const env = createEnvelope(baseInput());
    expect(env.version).toBe(ENVELOPE_VERSION);
    expect(env.merchantAddress).toBe(MERCHANT);
    expect(env.payerAddress).toBeUndefined();
    expect(verifyEnvelope(env, { now: NOW })).toBe(true);

    const json = exportEnvelopeJson(env);
    const imported = importEnvelope(json, { now: NOW });
    expect(imported).toEqual(env);
  });

  it("round-trips with an optional payer address", () => {
    const env = createEnvelope(baseInput({ payerAddress: PAYER }));
    expect(env.payerAddress).toBe(PAYER);
    const imported = importEnvelope(exportEnvelopeJson(env), { now: NOW });
    expect(imported.payerAddress).toBe(PAYER);
    expect(verifyEnvelope(imported, { now: NOW })).toBe(true);
  });
});

describe("qr-ferry canonical encoding — determinism", () => {
  it("is byte-identical for two envelopes with the same normalized fields", () => {
    const a = createEnvelope(baseInput());
    const b = createEnvelope(baseInput());
    expect(canonicalEnvelopeEncoding(a)).toBe(canonicalEnvelopeEncoding(b));
  });

  it("changes when any covered field changes", () => {
    const env = createEnvelope(baseInput());
    const enc = canonicalEnvelopeEncoding(env);
    const modified = createEnvelope(baseInput({ quantity: 3 }));
    expect(canonicalEnvelopeEncoding(modified)).not.toBe(enc);
  });

  it("canonicalizes merchant address (case/length) so equivalent inputs match", () => {
    const upper = createEnvelope(
      baseInput({ merchantAddress: MERCHANT.toUpperCase() as `0x${string}` }),
    );
    const lower = createEnvelope(baseInput());
    // Both must normalize to the same canonical merchant address.
    expect(upper.merchantAddress).toBe(lower.merchantAddress);
    expect(canonicalEnvelopeEncoding(upper)).toBe(canonicalEnvelopeEncoding(lower));
  });
});

describe("qr-ferry import — rejection cases", () => {
  it("rejects malformed JSON", () => {
    expect(() => importEnvelope("{not json")).toThrow(QrFerryError);
    expect(() => importEnvelope("null")).toThrow(QrFerryError);
  });

  it("rejects unsupported version", () => {
    const env = createEnvelope(baseInput());
    const obj = JSON.parse(exportEnvelopeJson(env));
    obj.version = 2;
    expect(() => importEnvelope(JSON.stringify(obj))).toThrow(QrFerryError);
  });

  it("rejects a modified (checksum-tampered) field", () => {
    const env = createEnvelope(baseInput());
    const obj = JSON.parse(exportEnvelopeJson(env));
    obj.quantity = 99; // change a covered field without updating checksum
    expect(() => importEnvelope(JSON.stringify(obj))).toThrow(QrFerryError);
  });

  it("rejects an invalid merchant address", () => {
    expect(() =>
      createEnvelope(baseInput({ merchantAddress: "0xdeadbeef" as `0x${string}` })),
    ).toThrow(QrFerryError);
  });

  it("rejects zero totalMist", () => {
    expect(() => createEnvelope(baseInput({ totalMist: 0n }))).toThrow(QrFerryError);
  });

  it("rejects over-cap totalMist", () => {
    expect(() =>
      createEnvelope(baseInput({ totalMist: 10n ** 18n })),
    ).toThrow(QrFerryError);
  });

  it("rejects expired envelope", () => {
    const env = createEnvelope(
      baseInput({ createdAt: NOW - 120_000, expiresAt: NOW - 60_000 }),
    );
    expect(() => verifyEnvelope(env, { now: NOW })).toThrow(QrFerryError);
  });

  it("rejects future createdAt beyond clock skew", () => {
    const env = createEnvelope(
      baseInput({ createdAt: NOW + 120_000, expiresAt: NOW + 180_000 }),
    );
    expect(() => verifyEnvelope(env, { now: NOW })).toThrow(QrFerryError);
  });

  it("rejects expiresAt not after createdAt", () => {
    expect(() =>
      createEnvelope(baseInput({ createdAt: NOW, expiresAt: NOW })),
    ).toThrow(QrFerryError);
  });

  it("rejects expiry window exceeding the cap", () => {
    expect(() =>
      createEnvelope(baseInput({ createdAt: NOW, expiresAt: NOW + 48 * 60 * 60 * 1000 })),
    ).toThrow(QrFerryError);
  });

  it("rejects non-positive quantity", () => {
    expect(() => createEnvelope(baseInput({ quantity: 0 }))).toThrow(QrFerryError);
  });

  it("rejects empty item", () => {
    expect(() => createEnvelope(baseInput({ item: "" }))).toThrow(QrFerryError);
  });

  it("rejects empty nonce", () => {
    expect(() => createEnvelope(baseInput({ nonce: "" }))).toThrow(QrFerryError);
  });

  it("rejects an invalid payer address when present", () => {
    expect(() =>
      createEnvelope(baseInput({ payerAddress: "0xnope" as `0x${string}` })),
    ).toThrow(QrFerryError);
  });
});

describe("qr-ferry replay registry", () => {
  it("consumes a nonce once and rejects duplicate reuse", () => {
    const registry = new InMemoryReplayRegistry();
    const env = createEnvelope(baseInput());
    expect(registry.tryConsume(env.nonce)).toBe(true);
    expect(registry.tryConsume(env.nonce)).toBe(false);
  });

  it("importEnvelope + settle consumes the nonce once", () => {
    const registry = new InMemoryReplayRegistry();
    const env = createEnvelope(baseInput());
    const json = exportEnvelopeJson(env);
    const settled = importEnvelope(json, { now: NOW, registry });
    expect(settled.nonce).toBe(env.nonce);
    // Re-importing the same payload must now fail as a duplicate nonce.
    expect(() => importEnvelope(json, { now: NOW, registry })).toThrow(QrFerryError);
  });

  it("does not mark the nonce when validation fails before consume", () => {
    const registry = new InMemoryReplayRegistry();
    const env = createEnvelope(baseInput({ createdAt: NOW - 120_000, expiresAt: NOW - 60_000 }));
    const json = exportEnvelopeJson(env);
    // Expired — must throw AND must not consume the nonce.
    expect(() => importEnvelope(json, { now: NOW, registry })).toThrow(QrFerryError);
    expect(registry.tryConsume(env.nonce)).toBe(true);
  });
});

/**
 * Craft an envelope JSON with a recomputed valid checksum but arbitrary
 * (possibly invalid) field values. This bypasses `createEnvelope` validation
 * to simulate a peer that minted its own checksummed envelope outside our
 * mint-time bounds — exactly the asymmetric-wire-contract attack surface.
 */
function craftEnvelopeJson(overrides: Partial<QrFerryEnvelope> = {}): string {
  const base = createEnvelope(baseInput());
  const env: QrFerryEnvelope = { ...base, ...overrides };
  const digest = blake2b(
    new TextEncoder().encode(canonicalEnvelopeEncoding(env)),
    { dkLen: 32 },
  );
  env.checksum = `0x${[...digest]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
  return exportEnvelopeJson(env);
}

describe("qr-ferry verify/import — mint-time upper bounds mirrored", () => {
  it("rejects an imported envelope with item exceeding MAX_ITEM_LENGTH (valid checksum)", () => {
    const json = craftEnvelopeJson({ item: "x".repeat(MAX_ITEM_LENGTH + 1) });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_item/,
    );
  });

  it("rejects an imported envelope with quantity exceeding MAX_QUANTITY (valid checksum)", () => {
    const json = craftEnvelopeJson({ quantity: MAX_QUANTITY + 1 });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_quantity/,
    );
  });

  it("rejects an imported envelope with nonce exceeding MAX_NONCE_LENGTH (valid checksum)", () => {
    const json = craftEnvelopeJson({ nonce: "n".repeat(MAX_NONCE_LENGTH + 1) });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_nonce/,
    );
  });

  it("verifyEnvelope mirrors the same upper bounds (item/quantity/nonce)", () => {
    const oversizedItem = craftEnvelopeJson({ item: "x".repeat(MAX_ITEM_LENGTH + 1) });
    expect(() => verifyEnvelope(JSON.parse(oversizedItem), { now: NOW })).toThrow(
      /qr-ferry\/invalid_item/,
    );
    const oversizedQty = craftEnvelopeJson({ quantity: MAX_QUANTITY + 1 });
    expect(() => verifyEnvelope(JSON.parse(oversizedQty), { now: NOW })).toThrow(
      /qr-ferry\/invalid_quantity/,
    );
    const oversizedNonce = craftEnvelopeJson({ nonce: "n".repeat(MAX_NONCE_LENGTH + 1) });
    expect(() => verifyEnvelope(JSON.parse(oversizedNonce), { now: NOW })).toThrow(
      /qr-ferry\/invalid_nonce/,
    );
  });
});

describe("qr-ferry canonical encoding — delimiter injection", () => {
  it("createEnvelope rejects item containing '|' or '='", () => {
    expect(() => createEnvelope(baseInput({ item: "a|b" }))).toThrow(QrFerryError);
    expect(() => createEnvelope(baseInput({ item: "a=b" }))).toThrow(QrFerryError);
  });

  it("createEnvelope rejects nonce containing '|' or '='", () => {
    expect(() => createEnvelope(baseInput({ nonce: "a|b" }))).toThrow(QrFerryError);
    expect(() => createEnvelope(baseInput({ nonce: "a=b" }))).toThrow(QrFerryError);
  });

  it("importEnvelope rejects a valid-checksum envelope whose item contains '|'", () => {
    const json = craftEnvelopeJson({ item: "a|b" });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(/qr-ferry\/invalid_item/);
  });

  it("importEnvelope rejects a valid-checksum envelope whose item contains '='", () => {
    const json = craftEnvelopeJson({ item: "a=b" });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(/qr-ferry\/invalid_item/);
  });

  it("importEnvelope rejects a valid-checksum envelope whose nonce contains '|'", () => {
    const json = craftEnvelopeJson({ nonce: "a|b" });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(/qr-ferry\/invalid_nonce/);
  });

  it("importEnvelope rejects a valid-checksum envelope whose nonce contains '='", () => {
    const json = craftEnvelopeJson({ nonce: "a=b" });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(/qr-ferry\/invalid_nonce/);
  });

  it("does not regress: a benign item without delimiters still imports", () => {
    const env = createEnvelope(baseInput({ item: "Iced Coffee - 12oz" }));
    expect(verifyEnvelope(env, { now: NOW })).toBe(true);
  });
});

describe("qr-ferry verify/import — canonical address enforcement", () => {
  // A valid Sui address has many encodings (0X prefix, uppercase hex) that all
  // normalize to one canonical form (0x + 64 lowercase hex). The checksum
  // binds exactly one representation, so verify/import must reject any valid
  // but noncanonical wire encoding — otherwise two distinct envelopes with
  // different encodings of the same address would both pass with valid
  // checksums, breaking the one-canonical-representation invariant.
  const MERCHANT_0X = "0X".concat("11".repeat(32)) as `0x${string}`;
  const MERCHANT_UPPER = "0x".concat("AB".repeat(32)) as `0x${string}`;
  const PAYER_0X = "0X".concat("22".repeat(32)) as `0x${string}`;
  const PAYER_UPPER = "0x".concat("CD".repeat(32)) as `0x${string}`;

  it("rejects a valid-checksum envelope with 0X-prefixed merchantAddress", () => {
    const json = craftEnvelopeJson({ merchantAddress: MERCHANT_0X });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_merchant/,
    );
  });

  it("rejects a valid-checksum envelope with uppercase-hex merchantAddress", () => {
    const json = craftEnvelopeJson({ merchantAddress: MERCHANT_UPPER });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_merchant/,
    );
  });

  it("rejects a valid-checksum envelope with 0X-prefixed payerAddress", () => {
    const json = craftEnvelopeJson({ payerAddress: PAYER_0X });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_payer/,
    );
  });

  it("rejects a valid-checksum envelope with uppercase-hex payerAddress", () => {
    const json = craftEnvelopeJson({ payerAddress: PAYER_UPPER });
    expect(() => importEnvelope(json, { now: NOW })).toThrow(QrFerryError);
    expect(() => importEnvelope(json, { now: NOW })).toThrow(
      /qr-ferry\/invalid_payer/,
    );
  });

  it("verifyEnvelope mirrors the canonical-address rejection for merchant and payer", () => {
    const merchantJson = craftEnvelopeJson({ merchantAddress: MERCHANT_0X });
    expect(() =>
      verifyEnvelope(JSON.parse(merchantJson), { now: NOW }),
    ).toThrow(/qr-ferry\/invalid_merchant/);
    const payerJson = craftEnvelopeJson({ payerAddress: PAYER_UPPER });
    expect(() =>
      verifyEnvelope(JSON.parse(payerJson), { now: NOW }),
    ).toThrow(/qr-ferry\/invalid_payer/);
  });

  it("does not regress: canonical merchant and payer addresses still import", () => {
    const env = createEnvelope(baseInput({ payerAddress: PAYER }));
    expect(verifyEnvelope(env, { now: NOW })).toBe(true);
    const imported = importEnvelope(exportEnvelopeJson(env), { now: NOW });
    expect(imported.merchantAddress).toBe(MERCHANT);
    expect(imported.payerAddress).toBe(PAYER);
  });
});

describe("qr-ferry — tamper-evident labeling", () => {
  it("does not expose any signature/authorization claim on the envelope", () => {
    const env = createEnvelope(baseInput());
    const json = exportEnvelopeJson(env);
    expect(json).not.toMatch(/sig|signature|authorize|authoriz/i);
    // checksum is a blake2b256 hex of the canonical encoding, recomputed
    // independently of the module under test (raw noble blake2b + manual hex).
    const digest = blake2b(
      new TextEncoder().encode(canonicalEnvelopeEncoding(env)),
      { dkLen: 32 },
    );
    const recomputed = `0x${[...digest]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    expect(env.checksum).toBe(recomputed);
  });
});
