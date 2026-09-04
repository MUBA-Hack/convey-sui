import "server-only";

import { randomBytes as nodeRandomBytes } from "node:crypto";
import { SealClient } from "@mysten/seal";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import { blake2b256, toHex } from "@/lib/protocol/hash";
import {
  SEALED_EVIDENCE_SCHEMA_VERSION,
  SEALED_EVIDENCE_THRESHOLD,
  SEAL_TESTNET_KEY_SERVER_IDS,
  WALRUS_TESTNET_AGGREGATOR,
  WALRUS_TESTNET_PUBLISHER,
  type SealedEvidenceStored,
} from "./sealed-evidence";

export {
  SEALED_EVIDENCE_SCHEMA_VERSION,
  SEALED_EVIDENCE_THRESHOLD,
  SEAL_TESTNET_KEY_SERVER_IDS,
  WALRUS_TESTNET_AGGREGATOR,
  WALRUS_TESTNET_PUBLISHER,
} from "./sealed-evidence";

const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);
const WALRUS_BLOB_ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const MAX_EVIDENCE_CODE_POINTS = 4_096;
const WALRUS_UPLOAD_TIMEOUT_MS = 120_000;

export interface WalrusStoreResult {
  blobId: string;
  blobObjectId?: string;
  endEpoch: number;
}

interface SealEncryptInput {
  packageId: string;
  id: string;
  data: Uint8Array;
  aad: Uint8Array;
}

interface SealEncryptResult {
  encryptedObject: Uint8Array;
  key: Uint8Array;
}

export interface SealAndStoreEvidenceDependencies {
  encrypt?: (input: SealEncryptInput) => Promise<SealEncryptResult>;
  upload?: (ciphertext: Uint8Array) => Promise<WalrusStoreResult>;
  randomBytes?: (size: number) => Uint8Array;
}

export type SealedEvidenceResult =
  | SealedEvidenceStored
  | {
      kind: "unavailable";
      reason: "invalid_configuration" | "encryption_failed" | "storage_failed";
    };

function safePackageId(value: string): string | null {
  try {
    const normalized = normalizeSuiAddress(value.trim());
    return isValidSuiAddress(normalized) && normalized !== SUI_ZERO_ADDRESS
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function safeEvidenceText(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > MAX_EVIDENCE_CODE_POINTS ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function integerEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function objectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const normalized = normalizeSuiAddress(value);
    return isValidSuiAddress(normalized) && normalized !== SUI_ZERO_ADDRESS
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function blobId(value: unknown): string | null {
  return typeof value === "string" && WALRUS_BLOB_ID_PATTERN.test(value)
    ? value
    : null;
}

export function parseWalrusStoreResponse(value: unknown): WalrusStoreResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Walrus publisher returned an invalid response.");
  }
  const record = value as Record<string, unknown>;
  const hasNew = record.newlyCreated !== undefined;
  const hasExisting = record.alreadyCertified !== undefined;
  if (hasNew === hasExisting) {
    throw new Error("Walrus publisher returned an ambiguous response.");
  }

  if (hasNew) {
    const newlyCreated = record.newlyCreated;
    if (typeof newlyCreated !== "object" || newlyCreated === null) {
      throw new Error("Walrus publisher returned invalid created metadata.");
    }
    const blobObject = (newlyCreated as Record<string, unknown>).blobObject;
    if (typeof blobObject !== "object" || blobObject === null) {
      throw new Error("Walrus publisher returned invalid blob metadata.");
    }
    const blobRecord = blobObject as Record<string, unknown>;
    const storage = blobRecord.storage;
    const parsedBlobId = blobId(blobRecord.blobId);
    const parsedObjectId = objectId(blobRecord.id);
    const endEpoch =
      typeof storage === "object" && storage !== null
        ? integerEpoch((storage as Record<string, unknown>).endEpoch)
        : null;
    if (!parsedBlobId || !parsedObjectId || endEpoch === null) {
      throw new Error("Walrus publisher returned incomplete blob metadata.");
    }
    return { blobId: parsedBlobId, blobObjectId: parsedObjectId, endEpoch };
  }

  const alreadyCertified = record.alreadyCertified;
  if (typeof alreadyCertified !== "object" || alreadyCertified === null) {
    throw new Error("Walrus publisher returned invalid certified metadata.");
  }
  const certifiedRecord = alreadyCertified as Record<string, unknown>;
  const parsedBlobId = blobId(certifiedRecord.blobId);
  const endEpoch = integerEpoch(certifiedRecord.endEpoch);
  if (!parsedBlobId || endEpoch === null) {
    throw new Error("Walrus publisher returned incomplete certified metadata.");
  }
  return { blobId: parsedBlobId, endEpoch };
}

export async function uploadCiphertextToWalrus(
  ciphertext: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<WalrusStoreResult> {
  if (ciphertext.byteLength === 0 || ciphertext.byteLength > 64 * 1024) {
    throw new Error("Walrus ciphertext size is outside the supported range.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WALRUS_UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${WALRUS_TESTNET_PUBLISHER}/v1/blobs?epochs=5&permanent=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error(`Walrus publisher rejected storage with ${response.status}.`);
    }
    return parseWalrusStoreResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function createSealEncryptor(): (input: SealEncryptInput) => Promise<SealEncryptResult> {
  const suiClient = new SuiJsonRpcClient({
    network: "testnet",
    url: "https://sui-testnet-rpc.publicnode.com",
  });
  const client = new SealClient({
    suiClient,
    serverConfigs: SEAL_TESTNET_KEY_SERVER_IDS.map((serverObjectId) => ({
      objectId: serverObjectId,
      weight: 1,
    })),
    verifyKeyServers: true,
    timeout: 20_000,
  });
  return (input) =>
    client.encrypt({
      threshold: SEALED_EVIDENCE_THRESHOLD,
      packageId: input.packageId,
      id: input.id,
      data: input.data,
      aad: input.aad,
    });
}

export async function sealAndStoreEvidence(
  input: { packageId: string; evidenceText: string },
  dependencies: SealAndStoreEvidenceDependencies = {},
): Promise<SealedEvidenceResult> {
  const packageId = safePackageId(input.packageId);
  const evidenceText = safeEvidenceText(input.evidenceText);
  if (!packageId || !evidenceText) {
    return { kind: "unavailable", reason: "invalid_configuration" };
  }

  const random = dependencies.randomBytes ?? ((size: number) => nodeRandomBytes(size));
  const identity = random(32);
  if (!(identity instanceof Uint8Array) || identity.byteLength !== 32) {
    return { kind: "unavailable", reason: "invalid_configuration" };
  }
  const sealIdHex = toHex(identity);
  const canonicalPlaintext = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: SEALED_EVIDENCE_SCHEMA_VERSION,
      evidenceText,
    }),
  );
  const aad = new TextEncoder().encode(SEALED_EVIDENCE_SCHEMA_VERSION);
  const encrypt = dependencies.encrypt ?? createSealEncryptor();

  let encrypted: SealEncryptResult;
  try {
    encrypted = await encrypt({
      packageId,
      id: sealIdHex,
      data: canonicalPlaintext,
      aad,
    });
  } catch {
    return { kind: "unavailable", reason: "encryption_failed" };
  }

  try {
    if (
      !(encrypted.encryptedObject instanceof Uint8Array) ||
      encrypted.encryptedObject.byteLength === 0 ||
      !(encrypted.key instanceof Uint8Array) ||
      encrypted.key.byteLength !== 32
    ) {
      return { kind: "unavailable", reason: "encryption_failed" };
    }
    const upload = dependencies.upload ?? uploadCiphertextToWalrus;
    let stored: WalrusStoreResult;
    try {
      stored = await upload(encrypted.encryptedObject);
    } catch {
      return { kind: "unavailable", reason: "storage_failed" };
    }
    const result: SealedEvidenceStored = {
      kind: "stored",
      schemaVersion: SEALED_EVIDENCE_SCHEMA_VERSION,
      packageId,
      sealIdHex,
      walrusBlobId: stored.blobId,
      ...(stored.blobObjectId === undefined
        ? {}
        : { walrusBlobObjectId: stored.blobObjectId }),
      walrusEndEpoch: stored.endEpoch,
      walrusUrl: `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${stored.blobId}`,
      ciphertextDigestHex: toHex(blake2b256(encrypted.encryptedObject)),
      plaintextDigestHex: toHex(blake2b256(canonicalPlaintext)),
      threshold: SEALED_EVIDENCE_THRESHOLD,
      keyServerObjectIds: [
        SEAL_TESTNET_KEY_SERVER_IDS[0],
        SEAL_TESTNET_KEY_SERVER_IDS[1],
      ],
    };
    return result;
  } finally {
    if (encrypted.key instanceof Uint8Array) encrypted.key.fill(0);
  }
}
