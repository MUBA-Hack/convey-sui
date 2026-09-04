import { describe, expect, it, vi } from "vitest";
import {
  SEAL_TESTNET_KEY_SERVER_IDS,
  parseWalrusStoreResponse,
  sealAndStoreEvidence,
} from "./sealed-evidence.server";

const PACKAGE = "0x" + "44".repeat(32);

describe("sealAndStoreEvidence", () => {
  it("encrypts with a random identity, uploads only ciphertext, and wipes the backup key", async () => {
    const backupKey = new Uint8Array(32).fill(7);
    const encryptedObject = new Uint8Array([9, 8, 7, 6]);
    const encrypt = vi.fn(async (input: {
      packageId: string;
      id: string;
      data: Uint8Array;
      aad: Uint8Array;
    }) => {
      void input;
      return { encryptedObject, key: backupKey };
    });
    const upload = vi.fn(async () => ({
      blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
      blobObjectId: "0x" + "55".repeat(32),
      endEpoch: 123,
    }));
    const identity = Uint8Array.from({ length: 32 }, (_, index) => index);

    const result = await sealAndStoreEvidence(
      {
        packageId: PACKAGE,
        evidenceText: "Medicine collected by Ana",
      },
      {
        encrypt,
        upload,
        randomBytes: () => identity,
      },
    );

    expect(result.kind).toBe("stored");
    if (result.kind !== "stored") return;
    expect(result.sealIdHex).toBe(
      "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(result.packageId).toBe(PACKAGE);
    expect(result.threshold).toBe(2);
    expect(result.keyServerObjectIds).toEqual(SEAL_TESTNET_KEY_SERVER_IDS);
    expect(result.ciphertextDigestHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.plaintextDigestHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(encryptedObject);
    expect(encrypt).toHaveBeenCalledTimes(1);
    const encryptInput = encrypt.mock.calls[0]![0];
    expect(encryptInput.packageId).toBe(PACKAGE);
    expect(encryptInput.id).toBe(result.sealIdHex);
    expect(new TextDecoder().decode(encryptInput.data)).toContain("Medicine collected by Ana");
    expect(Array.from(backupKey)).toEqual(new Array(32).fill(0));
  });

  it("fails closed when encryption fails and never attempts storage", async () => {
    const upload = vi.fn();
    const result = await sealAndStoreEvidence(
      { packageId: PACKAGE, evidenceText: "Pickup evidence" },
      {
        encrypt: vi.fn(async () => {
          throw new Error("key server unavailable");
        }),
        upload,
        randomBytes: () => new Uint8Array(32).fill(1),
      },
    );
    expect(result).toEqual({ kind: "unavailable", reason: "encryption_failed" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails closed when the encryptor returns a malformed backup key", async () => {
    const upload = vi.fn();
    const result = await sealAndStoreEvidence(
      { packageId: PACKAGE, evidenceText: "Pickup evidence" },
      {
        encrypt: vi.fn(async () => ({
          encryptedObject: new Uint8Array([1, 2, 3]),
          key: [] as unknown as Uint8Array,
        })),
        upload,
        randomBytes: () => new Uint8Array(32).fill(1),
      },
    );
    expect(result).toEqual({ kind: "unavailable", reason: "encryption_failed" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails closed when Walrus storage fails and wipes the backup key", async () => {
    const backupKey = new Uint8Array(32).fill(9);
    const result = await sealAndStoreEvidence(
      { packageId: PACKAGE, evidenceText: "Pickup evidence" },
      {
        encrypt: vi.fn(async () => ({
          encryptedObject: new Uint8Array([1, 2, 3]),
          key: backupKey,
        })),
        upload: vi.fn(async () => {
          throw new Error("publisher unavailable");
        }),
        randomBytes: () => new Uint8Array(32).fill(2),
      },
    );
    expect(result).toEqual({ kind: "unavailable", reason: "storage_failed" });
    expect(Array.from(backupKey)).toEqual(new Array(32).fill(0));
  });

  it("accepts a complete bounded agreement artifact and rejects oversized text", async () => {
    const encrypt = vi.fn(async (input: {
      packageId: string;
      id: string;
      data: Uint8Array;
      aad: Uint8Array;
    }) => {
      void input;
      return {
        encryptedObject: new Uint8Array([1]),
        key: new Uint8Array(32),
      };
    });
    const upload = vi.fn(async () => ({
      blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
      endEpoch: 123,
    }));
    const complete = await sealAndStoreEvidence(
      { packageId: PACKAGE, evidenceText: "x".repeat(1_500) },
      { encrypt, upload, randomBytes: () => new Uint8Array(32) },
    );
    expect(complete.kind).toBe("stored");

    const oversized = await sealAndStoreEvidence(
      { packageId: PACKAGE, evidenceText: "x".repeat(4_097) },
      { encrypt, upload, randomBytes: () => new Uint8Array(32) },
    );
    expect(oversized).toEqual({ kind: "unavailable", reason: "invalid_configuration" });
  });
});

describe("parseWalrusStoreResponse", () => {
  it("accepts newly-created and already-certified publisher responses", () => {
    expect(
      parseWalrusStoreResponse({
        newlyCreated: {
          blobObject: {
            id: "0x" + "66".repeat(32),
            blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
            storage: { endEpoch: 42 },
          },
        },
      }),
    ).toEqual({
      blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
      blobObjectId: "0x" + "66".repeat(32),
      endEpoch: 42,
    });

    expect(
      parseWalrusStoreResponse({
        alreadyCertified: {
          blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
          endEpoch: 43,
        },
      }),
    ).toEqual({
      blobId: "M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk",
      endEpoch: 43,
    });
  });

  it("rejects malformed or ambiguous publisher responses", () => {
    expect(() => parseWalrusStoreResponse({})).toThrow(/Walrus/i);
    expect(() =>
      parseWalrusStoreResponse({
        newlyCreated: { blobObject: { id: "not-an-id", blobId: "bad", storage: {} } },
      }),
    ).toThrow(/Walrus/i);
  });
});
