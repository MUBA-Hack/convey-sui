import { beforeEach, describe, expect, it } from "vitest";
import {
  PROTECTED_AGREEMENT_STORE_KEY,
  listProtectedAgreementArtifacts,
  storeProtectedAgreementArtifact,
  type ProtectedAgreementStorage,
} from "./protected-agreement-store";

describe("protected agreement private artifact store", () => {
  let values: Map<string, string>;
  let storage: ProtectedAgreementStorage;

  beforeEach(() => {
    values = new Map();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  });

  it("stores the full canonical artifact off-chain under its on-chain commitment", () => {
    storeProtectedAgreementArtifact({
      commitmentHex: `0x${"ab".repeat(32)}`,
      canonicalEncoding: JSON.stringify({ originalIntent: "Send Ana 25 USDC for medicine" }),
      createdDigest: "5QvPublicCreatedDigest",
      storedAt: 1_700_000_000_000,
    }, storage);

    expect(listProtectedAgreementArtifacts(storage)).toEqual([
      {
        version: "convey.protected-agreement-artifact.v1",
        commitmentHex: `0x${"ab".repeat(32)}`,
        canonicalEncoding: JSON.stringify({ originalIntent: "Send Ana 25 USDC for medicine" }),
        createdDigest: "5QvPublicCreatedDigest",
        storedAt: 1_700_000_000_000,
      },
    ]);
    expect(storage.getItem(PROTECTED_AGREEMENT_STORE_KEY)).not.toBeNull();
  });

  it("fails closed on corrupt storage", () => {
    storage.setItem(PROTECTED_AGREEMENT_STORE_KEY, "not-json");
    expect(listProtectedAgreementArtifacts(storage)).toEqual([]);
  });
});
