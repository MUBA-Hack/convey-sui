import { describe, expect, it } from "vitest";
import { blake2b256, toHex } from "../protocol/hash";
import {
  CUSTODY_EVIDENCE_SCHEMA_VERSION,
  type CustodyManifest,
  computeCustodyManifestDigest,
} from "./custody-evidence";
import {
  type MedicineOrderCommitment,
  type MedicineOrderCommitmentInput,
  MedicineOrderCommitmentInputSchema,
  prepareMedicineOrderCommitment,
} from "./medicine-order-commitment";
import { createReferencePharmacyProvider } from "./reference-network";
import type { PharmacySite } from "./network";

const provider = createReferencePharmacyProvider();

async function maritesSite(): Promise<PharmacySite> {
  const r = await provider.resolvePharmacy("phx-ref-marites01");
  if (!r.ok) throw new Error("marites site missing");
  return r.site;
}

const BENEFICIARY = "R-ABCD1234";
const ORDER_REF = "ORD-MARITES01";
const START = 1_700_000_000_000;
const END = 1_700_008_640_000;

async function baseInput(
  overrides: Partial<MedicineOrderCommitmentInput> = {},
): Promise<MedicineOrderCommitmentInput> {
  return {
    site: await maritesSite(),
    beneficiaryRef: BENEFICIARY,
    orderRef: ORDER_REF,
    startMs: START,
    endMs: END,
    ...overrides,
  } as MedicineOrderCommitmentInput;
}

async function prepare(
  overrides: Partial<MedicineOrderCommitmentInput> = {},
): Promise<MedicineOrderCommitment> {
  const r = prepareMedicineOrderCommitment(await baseInput(overrides));
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.commitment;
}

describe("prepareMedicineOrderCommitment — success shape", () => {
  it("returns a strict manifest with one pharmacy_order artifact bound to the site id", async () => {
    const c = await prepare();
    expect(c.manifest.schemaVersion).toBe(CUSTODY_EVIDENCE_SCHEMA_VERSION);
    expect(c.manifest.pharmacyId).toBe("phx-ref-marites01");
    expect(c.manifest.artifacts).toHaveLength(1);
    expect(c.manifest.artifacts[0]!.kind).toBe("pharmacy_order");
    if (c.manifest.artifacts[0]!.kind === "pharmacy_order") {
      expect(c.manifest.artifacts[0]!.pharmacyId).toBe("phx-ref-marites01");
    }
    expect(c.manifest.escrowWindowMs).toEqual({ startMs: START, endMs: END });
  });

  it("manifest digest matches an independently computed canonical digest", async () => {
    const c = await prepare();
    const expectedPayload = {
      schemaVersion: CUSTODY_EVIDENCE_SCHEMA_VERSION,
      missionId: c.manifest.missionId,
      pharmacyId: "phx-ref-marites01",
      beneficiaryRefDigest: toHex(
        blake2b256(new TextEncoder().encode(BENEFICIARY)),
      ),
      escrowWindowMs: { startMs: START, endMs: END },
      artifacts: [
        {
          kind: "pharmacy_order" as const,
          pharmacyId: "phx-ref-marites01",
          orderRefDigest: toHex(
            blake2b256(new TextEncoder().encode(ORDER_REF)),
          ),
        },
      ],
    };
    expect(c.manifest.manifestDigest).toBe(
      computeCustodyManifestDigest(expectedPayload),
    );
  });

  it("beneficiary digest is blake2b256 of the raw beneficiary ref", async () => {
    const c = await prepare();
    expect(c.manifest.beneficiaryRefDigest).toBe(
      toHex(blake2b256(new TextEncoder().encode(BENEFICIARY))),
    );
  });

  it("order ref digest inside the artifact is blake2b256 of the raw order ref", async () => {
    const c = await prepare();
    if (c.manifest.artifacts[0]!.kind === "pharmacy_order") {
      expect(c.manifest.artifacts[0]!.orderRefDigest).toBe(
        toHex(blake2b256(new TextEncoder().encode(ORDER_REF))),
      );
    }
  });

  it("summary carries pharmacy id, display name, coverage, user-facing orderRef, and adapter provenance", async () => {
    const c = await prepare();
    expect(c.summary.pharmacyId).toBe("phx-ref-marites01");
    expect(c.summary.pharmacyDisplayName).toBe("Marites Pharmacy");
    expect(c.summary.coverage).toEqual({ country: "PH", city: "Manila" });
    expect(c.summary.orderRef).toBe(ORDER_REF);
    expect(c.summary.provenance.kind).toBe("reference");
    expect(c.summary.provenance.sourceLabel).toBe("Convey reference network");
  });

  it("never carries verified/approved/released status anywhere in the manifest", async () => {
    const c = await prepare();
    const json = JSON.stringify(c.manifest);
    expect(json).not.toMatch(/verified|approved|released|authentic|settled/i);
  });
});

describe("prepareMedicineOrderCommitment — determinism", () => {
  it("same input produces identical missionId and manifestDigest", async () => {
    const a = await prepare();
    const b = await prepare();
    expect(a.manifest.missionId).toBe(b.manifest.missionId);
    expect(a.manifest.manifestDigest).toBe(b.manifest.manifestDigest);
  });

  it("missionId is bounded and hex-suffixed", async () => {
    const c = await prepare();
    expect(c.manifest.missionId).toMatch(/^mission-[a-f0-9]{1,53}$/);
    expect(c.manifest.missionId.length).toBeLessThanOrEqual(64);
  });

  it("manifest digest changes when the pharmacy changes", async () => {
    const a = await prepare();
    const bayani = await provider.resolvePharmacy("phx-ref-bayani04");
    if (!bayani.ok) throw new Error("bayani missing");
    const b = await prepare({
      site: bayani.site,
      orderRef: "ORD-BAYANI0004",
    });
    expect(a.manifest.manifestDigest).not.toBe(b.manifest.manifestDigest);
    expect(a.manifest.missionId).not.toBe(b.manifest.missionId);
  });

  it("manifest digest changes when the beneficiary ref changes", async () => {
    const a = await prepare();
    const b = await prepare({ beneficiaryRef: "R-WXYZ9876" });
    expect(a.manifest.manifestDigest).not.toBe(b.manifest.manifestDigest);
    expect(a.manifest.missionId).not.toBe(b.manifest.missionId);
  });

  it("manifest digest changes when the order ref changes", async () => {
    const a = await prepare();
    const b = await prepare({ orderRef: "ORD-NOPE00001" });
    expect(a.manifest.manifestDigest).not.toBe(b.manifest.manifestDigest);
    expect(a.manifest.missionId).not.toBe(b.manifest.missionId);
  });

  it("manifest digest changes when the window changes", async () => {
    const a = await prepare();
    const b = await prepare({ endMs: END + 1 });
    expect(a.manifest.manifestDigest).not.toBe(b.manifest.manifestDigest);
    expect(a.manifest.missionId).not.toBe(b.manifest.missionId);
  });
});

describe("prepareMedicineOrderCommitment — raw refs never enter the canonical manifest", () => {
  it("raw beneficiary ref and raw order ref are absent from the manifest JSON", async () => {
    const c = await prepare();
    const json = JSON.stringify(c.manifest);
    expect(json).not.toContain(BENEFICIARY);
    expect(json).not.toContain(ORDER_REF);
  });

  it("summary may retain the user-facing orderRef but never the raw beneficiary ref", async () => {
    const c = await prepare();
    expect(c.summary.orderRef).toBe(ORDER_REF);
    const json = JSON.stringify(c.summary);
    expect(json).not.toContain(BENEFICIARY);
  });
});

describe("prepareMedicineOrderCommitment — fail closed", () => {
  it("rejects an extra top-level input field", async () => {
    const input = await baseInput();
    const r = prepareMedicineOrderCommitment({ ...input, secret: "leak" } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed_input");
  });

  it("rejects a beneficiary ref without the R- prefix", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ beneficiaryRef: "ABCD1234" } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a beneficiary ref with lowercase", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ beneficiaryRef: "R-abcd1234" } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a beneficiary ref of wrong length", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ beneficiaryRef: "R-ABCD123" } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed order ref", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ orderRef: "ord-marites01" } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an inverted window (end before start)", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ startMs: END, endMs: START }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts an exactly-equal window boundary (end == start)", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ startMs: START, endMs: START }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a non-safe-integer start", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ startMs: Number.MAX_SAFE_INTEGER + 1 } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a non-safe-integer end", async () => {
    const r = prepareMedicineOrderCommitment(
      await baseInput({ endMs: Number.MAX_SAFE_INTEGER + 1 } as never),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a site carrying an extra field", async () => {
    const site = await maritesSite();
    const r = prepareMedicineOrderCommitment(
      await baseInput({ site: { ...site, secret: "no" } as unknown as PharmacySite }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    const r = prepareMedicineOrderCommitment(null as never);
    expect(r.ok).toBe(false);
  });

  it("MedicineOrderCommitmentInputSchema rejects extra fields", async () => {
    const input = await baseInput();
    const parsed = MedicineOrderCommitmentInputSchema.safeParse({
      ...input,
      walletKey: "leak",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("prepareMedicineOrderCommitment — immutability", () => {
  it("returns a deeply frozen manifest, artifacts, and summary", async () => {
    const c = await prepare();
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.manifest)).toBe(true);
    expect(Object.isFrozen(c.manifest.artifacts)).toBe(true);
    expect(Object.isFrozen(c.manifest.artifacts[0])).toBe(true);
    expect(Object.isFrozen(c.manifest.escrowWindowMs)).toBe(true);
    expect(Object.isFrozen(c.summary)).toBe(true);
    expect(Object.isFrozen(c.summary.coverage)).toBe(true);
    expect(Object.isFrozen(c.summary.provenance)).toBe(true);
  });

  it("mutating a frozen manifest field throws in strict mode", async () => {
    const c = await prepare();
    expect(() => {
      "use strict";
      (c.manifest as { pharmacyId?: string }).pharmacyId = "tampered";
    }).toThrow();
  });

  it("rejects replacing a commitment branch", async () => {
    const c = await prepare();
    const originalManifest = c.manifest;

    expect(() => {
      "use strict";
      (c as { manifest: CustodyManifest }).manifest = {
        ...originalManifest,
        pharmacyId: "tampered",
      } as CustodyManifest;
    }).toThrow();
    expect(c.manifest).toBe(originalManifest);
  });
});

describe("prepareMedicineOrderCommitment — reference provenance retained", () => {
  it("summary provenance stays reference and is not upgraded", async () => {
    const c = await prepare();
    expect(c.summary.provenance.kind).toBe("reference");
    expect(c.summary.provenance).not.toHaveProperty("partner");
  });
});
