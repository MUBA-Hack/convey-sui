import { describe, expect, it } from "vitest";
import { blake2b256, toHex } from "../protocol/hash";
import {
  CUSTODY_EVIDENCE_SCHEMA_VERSION,
  type CustodyArtifact,
  type CustodyEvidencePolicy,
  type CustodyManifest,
  CustodyManifestSchema,
  computeCustodyManifestDigest,
  evaluateCustodyEvidence,
} from "./custody-evidence";

const PHARMACY_ID = "pharm_klcentral_001";
const MISSION_ID = "mission_abc123";
const BENEFICIARY_REF_DIGEST = "0x" + "11".repeat(32);
const ORDER_REF_DIGEST = "0x" + "22".repeat(32);
const PHOTO_DIGEST = "0x" + "33".repeat(32);
const WITNESS_TEXT_DIGEST = "0x" + "44".repeat(32);
const REGION = "MY-10"; // coarse Malaysian state code (Kuala Lumpur)
const ESCROW_START = 1_700_000_000_000;
const ESCROW_END = 1_700_086_400_000;
const PICKUP_TS = 1_700_043_200_000; // inside window

const FULL_POLICY: CustodyEvidencePolicy = {
  requiredArtifactKinds: [
    "pharmacy_order",
    "package_photo",
    "pickup_event",
    "witness_statement",
  ],
};

function orderArtifact(overrides: Partial<CustodyArtifact> = {}): CustodyArtifact {
  return {
    kind: "pharmacy_order",
    pharmacyId: PHARMACY_ID,
    orderRefDigest: ORDER_REF_DIGEST,
    ...overrides,
  } as CustodyArtifact;
}

function photoArtifact(overrides: Partial<CustodyArtifact> = {}): CustodyArtifact {
  return {
    kind: "package_photo",
    photoDigest: PHOTO_DIGEST,
    ...overrides,
  } as CustodyArtifact;
}

function pickupArtifact(overrides: Partial<CustodyArtifact> = {}): CustodyArtifact {
  return {
    kind: "pickup_event",
    regionCode: REGION,
    timestampMs: PICKUP_TS,
    ...overrides,
  } as CustodyArtifact;
}

function witnessArtifact(overrides: Partial<CustodyArtifact> = {}): CustodyArtifact {
  return {
    kind: "witness_statement",
    role: "carrier",
    textDigest: WITNESS_TEXT_DIGEST,
    ...overrides,
  } as CustodyArtifact;
}

function manifest(
  artifacts: CustodyArtifact[],
  overrides: Partial<Omit<CustodyManifest, "artifacts" | "manifestDigest">> = {},
): Omit<CustodyManifest, "manifestDigest"> {
  return {
    schemaVersion: CUSTODY_EVIDENCE_SCHEMA_VERSION,
    missionId: MISSION_ID,
    pharmacyId: PHARMACY_ID,
    beneficiaryRefDigest: BENEFICIARY_REF_DIGEST,
    escrowWindowMs: { startMs: ESCROW_START, endMs: ESCROW_END },
    artifacts,
    ...overrides,
  };
}

describe("computeCustodyManifestDigest", () => {
  it("is deterministic: identical manifests produce identical digests", () => {
    const m = manifest([
      orderArtifact(),
      photoArtifact(),
      pickupArtifact(),
      witnessArtifact(),
    ]);
    expect(computeCustodyManifestDigest(m)).toEqual(computeCustodyManifestDigest(m));
  });

  it("is property-order independent at the input boundary", () => {
    const artifacts: CustodyArtifact[] = [
      orderArtifact(),
      photoArtifact(),
      pickupArtifact(),
      witnessArtifact(),
    ];
    const a = manifest(artifacts);
    const b: Omit<CustodyManifest, "manifestDigest"> = {
      // deliberately reordered key order
      artifacts,
      beneficiaryRefDigest: BENEFICIARY_REF_DIGEST,
      pharmacyId: PHARMACY_ID,
      missionId: MISSION_ID,
      escrowWindowMs: { endMs: ESCROW_END, startMs: ESCROW_START },
      schemaVersion: CUSTODY_EVIDENCE_SCHEMA_VERSION,
    };
    expect(computeCustodyManifestDigest(a)).toEqual(computeCustodyManifestDigest(b));
  });

  it("matches an independently built canonical encoding + blake2b256", () => {
    const m = manifest([orderArtifact(), pickupArtifact()]);
    const canonical = {
      schemaVersion: m.schemaVersion,
      missionId: m.missionId,
      pharmacyId: m.pharmacyId,
      beneficiaryRefDigest: m.beneficiaryRefDigest,
      escrowWindowMs: { startMs: m.escrowWindowMs.startMs, endMs: m.escrowWindowMs.endMs },
      artifacts: [
        { kind: "pharmacy_order", pharmacyId: PHARMACY_ID, orderRefDigest: ORDER_REF_DIGEST },
        { kind: "pickup_event", regionCode: REGION, timestampMs: PICKUP_TS },
      ],
    };
    expect(computeCustodyManifestDigest(m)).toEqual(
      toHex(blake2b256(new TextEncoder().encode(JSON.stringify(canonical)))),
    );
  });

  it("changes when any bound field changes", () => {
    const base = manifest([orderArtifact()]);
    const d1 = computeCustodyManifestDigest(base);
    const d2 = computeCustodyManifestDigest(
      manifest([orderArtifact()], { missionId: "mission_other_999" }),
    );
    expect(d1).not.toEqual(d2);
  });
});

describe("evaluateCustodyEvidence", () => {
  it("returns ready_for_human_review when all required artifacts are present and coherent", () => {
    const result = evaluateCustodyEvidence({
      policy: FULL_POLICY,
      manifest: manifest([
        orderArtifact(),
        photoArtifact(),
        pickupArtifact(),
        witnessArtifact(),
      ]),
    });
    expect(result.kind).toBe("ready_for_human_review");
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("approved");
    expect(result).not.toHaveProperty("released");
  });

  it("returns questions_needed when a required artifact kind is missing", () => {
    const result = evaluateCustodyEvidence({
      policy: FULL_POLICY,
      manifest: manifest([
        orderArtifact(),
        photoArtifact(),
        pickupArtifact(),
        // witness_statement missing
      ]),
    });
    expect(result.kind).toBe("questions_needed");
    expect(result).toHaveProperty("missingArtifactKinds");
    expect(result).not.toHaveProperty("verified");
  });

  it("returns ready_for_human_review when policy requires a subset and that subset is present", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order", "pickup_event"] },
      manifest: manifest([orderArtifact(), pickupArtifact(), witnessArtifact()]),
    });
    expect(result.kind).toBe("ready_for_human_review");
  });

  it("rejects an empty required-artifact policy as invalid_policy", () => {
    // `.min(1)`: an empty policy would mark any coherent manifest review-ready,
    // so the schema rejects it. Callers must name at least one kind.
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([orderArtifact()]),
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reason).toBe("invalid_policy");
    }
  });

  it("rejects when pickup timestamp is before the escrow window", () => {
    const result = evaluateCustodyEvidence({
      policy: FULL_POLICY,
      manifest: manifest([
        orderArtifact(),
        photoArtifact(),
        pickupArtifact({ timestampMs: ESCROW_START - 1 } as never),
        witnessArtifact(),
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when pickup timestamp is after the escrow window", () => {
    const result = evaluateCustodyEvidence({
      policy: FULL_POLICY,
      manifest: manifest([
        orderArtifact(),
        photoArtifact(),
        pickupArtifact({ timestampMs: ESCROW_END + 1 } as never),
        witnessArtifact(),
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("accepts the exact escrow window boundaries for the pickup timestamp", () => {
    for (const ts of [ESCROW_START, ESCROW_END]) {
      const result = evaluateCustodyEvidence({
        policy: { requiredArtifactKinds: ["pickup_event"] },
        manifest: manifest([pickupArtifact({ timestampMs: ts } as never)]),
      });
      expect(result.kind).toBe("ready_for_human_review");
    }
  });

  it("rejects when two artifacts share the same kind (duplicate)", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order"] },
      manifest: manifest([orderArtifact(), orderArtifact({ orderRefDigest: "0x" + "55".repeat(32) } as never)]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when an artifact carries a malformed digest (wrong length)", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order"] },
      manifest: manifest([orderArtifact({ orderRefDigest: "0xdeadbeef" } as never)]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when an artifact carries a non-hex digest", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order"] },
      manifest: manifest([
        orderArtifact({ orderRefDigest: "0x" + "zz".repeat(32) } as never),
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the manifest carries an unknown artifact kind", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([{ kind: "unknown_thing" } as never]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when artifacts exceed the maximum of four", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        orderArtifact(),
        photoArtifact(),
        pickupArtifact(),
        witnessArtifact(),
        witnessArtifact({ textDigest: "0x" + "66".repeat(32) } as never),
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when artifacts is empty", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the manifest pharmacyId does not match the order artifact pharmacyId", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order"] },
      manifest: manifest([orderArtifact()], { pharmacyId: "pharm_other_002" }),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the escrow window is inverted (end before start)", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([orderArtifact()], {
        escrowWindowMs: { startMs: ESCROW_END, endMs: ESCROW_START },
      }),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the schema version is wrong", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([orderArtifact()], {
        schemaVersion: "convey.pharmacy.custody-evidence.v0" as never,
      }),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a package_photo artifact carries raw photo bytes", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "package_photo", photoDigest: PHOTO_DIGEST, photoBytes: "abc" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a package_photo artifact carries a URL", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "package_photo", photoDigest: PHOTO_DIGEST, url: "https://x/y.jpg" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a witness_statement artifact carries raw text", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "witness_statement", role: "carrier", textDigest: WITNESS_TEXT_DIGEST, text: "I saw it" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a witness_statement artifact carries a person name", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "witness_statement", role: "carrier", textDigest: WITNESS_TEXT_DIGEST, personName: "Ali" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a pickup_event artifact carries exact geolocation", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "pickup_event", regionCode: REGION, timestampMs: PICKUP_TS, lat: 3.139, lng: 101.6869 } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a pharmacy_order artifact carries a drug name", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "pharmacy_order", pharmacyId: PHARMACY_ID, orderRefDigest: ORDER_REF_DIGEST, drugName: "paracetamol" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a pharmacy_order artifact carries a prescription body", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([
        { kind: "pharmacy_order", pharmacyId: PHARMACY_ID, orderRefDigest: ORDER_REF_DIGEST, prescription: "take 2x daily" } as never,
      ]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when a witness role is not in the allowed enum", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([witnessArtifact({ role: "doctor" } as never)]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the region code is too long", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([pickupArtifact({ regionCode: "X".repeat(33) } as never)]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the timestamp is not a safe integer", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: manifest([pickupArtifact({ timestampMs: Number.MAX_SAFE_INTEGER + 1 } as never)]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the manifest carries an extra top-level field", () => {
    const m = manifest([orderArtifact()]) as Record<string, unknown>;
    m.secretKey = "leak";
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: [] },
      manifest: m as never,
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the policy requires an unknown artifact kind", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["not_a_kind" as never] },
      manifest: manifest([orderArtifact()]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("rejects when the policy has duplicate required kinds", () => {
    const result = evaluateCustodyEvidence({
      policy: { requiredArtifactKinds: ["pharmacy_order", "pharmacy_order"] },
      manifest: manifest([orderArtifact()]),
    });
    expect(result.kind).toBe("rejected");
  });

  it("questions_needed lists the missing kinds in canonical order", () => {
    const result = evaluateCustodyEvidence({
      policy: FULL_POLICY,
      manifest: manifest([pickupArtifact()]),
    });
    expect(result.kind).toBe("questions_needed");
    if (result.kind === "questions_needed") {
      expect(result.missingArtifactKinds).toEqual([
        "pharmacy_order",
        "package_photo",
        "witness_statement",
      ]);
    }
  });
});

describe("CustodyManifestSchema", () => {
  function manifestWithDigest(
    overrides: Partial<Omit<CustodyManifest, "manifestDigest">> = {},
  ): CustodyManifest {
    const payload = manifest([orderArtifact(), pickupArtifact()], overrides);
    return { ...payload, manifestDigest: computeCustodyManifestDigest(payload) };
  }

  it("round-trips a valid manifest with a correct digest", () => {
    const manifestDoc = manifestWithDigest();
    const parsed = CustodyManifestSchema.safeParse(manifestDoc);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.manifestDigest).toBe(manifestDoc.manifestDigest);
      expect(parsed.data.missionId).toBe(MISSION_ID);
    }
  });

  it("rejects a wrong digest without throwing", () => {
    const manifestDoc = manifestWithDigest();
    const tampered = {
      ...manifestDoc,
      manifestDigest: "0x" + "ee".repeat(32),
    };
    const parsed = CustodyManifestSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /manifestDigest/.test(i.message))).toBe(true);
    }
  });

  it("safeParse never throws on a malformed payload", () => {
    // A payload that breaks cross-field invariants (inverted escrow window)
    // must produce a failed safeParse, not a thrown error.
    const malformed = manifestWithDigest({
      escrowWindowMs: { startMs: ESCROW_END, endMs: ESCROW_START },
    });
    // Recompute digest over the malformed payload so the only failure is the
    // cross-field invariant, not a digest mismatch.
    malformed.manifestDigest = computeCustodyManifestDigest({
      ...malformed,
      escrowWindowMs: { startMs: ESCROW_END, endMs: ESCROW_START },
    });
    expect(() => CustodyManifestSchema.safeParse(malformed)).not.toThrow();
    const parsed = CustodyManifestSchema.safeParse(malformed);
    expect(parsed.success).toBe(false);
  });

  it("safeParse never throws on a structurally malformed payload", () => {
    // Missing fields, wrong types, and extra fields must fail closed via
    // safeParse without throwing.
    expect(() => CustodyManifestSchema.safeParse(null)).not.toThrow();
    expect(() => CustodyManifestSchema.safeParse("not-an-object")).not.toThrow();
    expect(() =>
      CustodyManifestSchema.safeParse({ ...manifestWithDigest(), extra: "leak" }),
    ).not.toThrow();
    expect(() =>
      CustodyManifestSchema.safeParse({ ...manifestWithDigest(), missionId: 123 }),
    ).not.toThrow();
  });
});
