/**
 * Offline QR Ferry — tamper-evident transport envelope.
 *
 * This is a TRANSPORT envelope, not cryptographic payer authorization. It
 * carries a purchase intent across an air-gapped QR ferry (generate on one
 * device, import on another) and detects tampering via a deterministic
 * checksum over a canonical encoding of the normalized fields. Replay is
 * defended against by a consume-once nonce registry (in-memory for demo
 * scope; production requires an on-chain nonce registry or trusted sponsor
 * index).
 *
 * Envelope fields (wire contract — do not renumber/reshape casually):
 *   version, item, quantity, totalMist, merchantAddress, payerAddress?,
 *   nonce, createdAt, expiresAt, checksum.
 */
import { blake2b256, toHex } from "../protocol/hash";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";

/** Current and only supported envelope wire version. */
export const ENVELOPE_VERSION = 1 as const;

/** 1 SUI = 1e9 MIST. Cap total at 1,000,000 SUI (1e15 MIST) — strict demo cap. */
export const MAX_TOTAL_MIST = 1_000_000n * 1_000_000_000n; // 1e15 MIST

/** Maximum lifetime of an envelope (24h). */
export const MAX_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Allowed clock skew for createdAt vs. verifier now (60s). */
export const CLOCK_SKEW_MS = 60_000;

/** Field bounds. */
export const MAX_ITEM_LENGTH = 128;
export const MAX_QUANTITY = 1_000_000;
export const MAX_NONCE_LENGTH = 64;

/**
 * Characters forbidden in free-text covered fields (`item`, `nonce`) because
 * they are structural delimiters of `canonicalEnvelopeEncoding` (`key=value`
 * joined by `|`). Allowing them would let two distinct field sets produce the
 * same canonical bytes (collision), defeating the tamper-evident checksum.
 * Addresses are excluded: they are validated as Sui addresses (hex) and can
 * never contain these characters.
 */
export const FORBIDDEN_FIELD_CHARS = ["|", "="] as const;

/** Canonical, fixed key order for the checksummed encoding. */
const CANONICAL_KEYS = [
  "version",
  "item",
  "quantity",
  "totalMist",
  "merchantAddress",
  "payerAddress",
  "nonce",
  "createdAt",
  "expiresAt",
] as const;

/** Input used to mint a new envelope (checksum computed by `createEnvelope`). */
export interface QrFerryEnvelopeInput {
  item: string;
  quantity: number;
  totalMist: bigint;
  merchantAddress: `0x${string}`;
  payerAddress?: `0x${string}`;
  nonce: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

/** A complete, verified-shape envelope with checksum. */
export interface QrFerryEnvelope {
  version: typeof ENVELOPE_VERSION;
  item: string;
  quantity: number;
  totalMist: string; // string to preserve u64 precision across JSON
  merchantAddress: `0x${string}`;
  payerAddress?: `0x${string}`;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  checksum: `0x${string}`; // blake2b256 hex of canonical encoding
}

/** Replay registry abstraction — consume each nonce at most once. */
export interface ReplayRegistry {
  /** Returns true if the nonce was newly consumed; false if already used. */
  tryConsume(nonce: string): boolean;
}

/** In-memory ReplayRegistry for demo scope. Not durable across processes. */
export class InMemoryReplayRegistry implements ReplayRegistry {
  private readonly seen = new Set<string>();
  tryConsume(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    return true;
  }
}

/** Discriminated error so callers can branch on reason without parsing strings. */
export type QrFerryErrorReason =
  | "malformed_json"
  | "unsupported_version"
  | "invalid_shape"
  | "invalid_merchant"
  | "invalid_payer"
  | "invalid_amount"
  | "invalid_quantity"
  | "invalid_item"
  | "invalid_nonce"
  | "invalid_timestamps"
  | "expired"
  | "future"
  | "checksum_mismatch"
  | "duplicate_nonce";

export class QrFerryError extends Error {
  readonly reason: QrFerryErrorReason;
  constructor(reason: QrFerryErrorReason, message: string) {
    super(`qr-ferry/${reason}: ${message}`);
    this.name = "QrFerryError";
    this.reason = reason;
  }
}

function fail(reason: QrFerryErrorReason, detail: string): never {
  throw new QrFerryError(reason, detail);
}

/**
 * Reject free-text covered fields that contain a canonical-encoding
 * delimiter (`|` or `=`). Without this, `item=a|quantity=2` and
 * `item=a|quantity` + `=2` (etc.) would hash to the same checksum, breaking
 * the tamper-evident property. Applied symmetrically on mint and verify.
 */
function rejectDelimiterInjection(
  reason: "invalid_item" | "invalid_nonce",
  field: string,
  value: string,
): void {
  for (const ch of FORBIDDEN_FIELD_CHARS) {
    if (value.includes(ch)) {
      fail(reason, `${field} must not contain '${ch}'`);
    }
  }
}

function normalizeAddress(addr: `0x${string}`): `0x${string}` {
  const display = addr.slice(0, 24);
  if (!isValidSuiAddress(addr)) {
    fail("invalid_merchant", `not a valid Sui address: ${display}`);
  }
  return normalizeSuiAddress(addr) as `0x${string}`;
}

function validateCommonFields(input: QrFerryEnvelopeInput): void {
  if (typeof input.item !== "string" || input.item.length === 0) {
    fail("invalid_item", "item must be a non-empty string");
  }
  if (input.item.length > MAX_ITEM_LENGTH) {
    fail("invalid_item", `item exceeds ${MAX_ITEM_LENGTH} chars`);
  }
  rejectDelimiterInjection("invalid_item", "item", input.item);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    fail("invalid_quantity", "quantity must be a positive integer");
  }
  if (input.quantity > MAX_QUANTITY) {
    fail("invalid_quantity", `quantity exceeds ${MAX_QUANTITY}`);
  }
  if (typeof input.totalMist !== "bigint" || input.totalMist <= 0n) {
    fail("invalid_amount", "totalMist must be a positive bigint");
  }
  if (input.totalMist > MAX_TOTAL_MIST) {
    fail("invalid_amount", `totalMist exceeds cap ${MAX_TOTAL_MIST.toString()}`);
  }
  if (typeof input.nonce !== "string" || input.nonce.length === 0) {
    fail("invalid_nonce", "nonce must be a non-empty string");
  }
  if (input.nonce.length > MAX_NONCE_LENGTH) {
    fail("invalid_nonce", `nonce exceeds ${MAX_NONCE_LENGTH} chars`);
  }
  rejectDelimiterInjection("invalid_nonce", "nonce", input.nonce);
  if (
    !Number.isInteger(input.createdAt) ||
    !Number.isInteger(input.expiresAt)
  ) {
    fail("invalid_timestamps", "createdAt/expiresAt must be integer ms");
  }
  if (input.expiresAt <= input.createdAt) {
    fail("invalid_timestamps", "expiresAt must be after createdAt");
  }
  if (input.expiresAt - input.createdAt > MAX_EXPIRY_WINDOW_MS) {
    fail("invalid_timestamps", "expiry window exceeds cap");
  }
}

/**
 * Deterministic canonical encoding of an envelope's covered fields. The
 * checksum is blake2b256 of these UTF-8 bytes. Field order is fixed; payer
 * is always present (empty string when absent) so presence/absence is part
 * of the checksum.
 */
export function canonicalEnvelopeEncoding(env: {
  version: number;
  item: string;
  quantity: number;
  totalMist: bigint | string;
  merchantAddress: `0x${string}`;
  payerAddress?: `0x${string}`;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}): string {
  const totalMistStr =
    typeof env.totalMist === "bigint" ? env.totalMist.toString() : env.totalMist;
  const parts: string[] = [
    `version=${env.version}`,
    `item=${env.item}`,
    `quantity=${env.quantity}`,
    `totalMist=${totalMistStr}`,
    `merchantAddress=${env.merchantAddress}`,
    `payerAddress=${env.payerAddress ?? ""}`,
    `nonce=${env.nonce}`,
    `createdAt=${env.createdAt}`,
    `expiresAt=${env.expiresAt}`,
  ];
  return parts.join("|");
}

function computeChecksum(env: Omit<QrFerryEnvelope, "checksum">): `0x${string}` {
  return toHex(
    blake2b256(new TextEncoder().encode(canonicalEnvelopeEncoding(env))),
  ) as `0x${string}`;
}

/** Mint a new tamper-evident envelope from validated input. */
export function createEnvelope(input: QrFerryEnvelopeInput): QrFerryEnvelope {
  validateCommonFields(input);
  const merchantAddress = normalizeAddress(input.merchantAddress);
  const payerAddress = input.payerAddress
    ? (() => {
        if (!isValidSuiAddress(input.payerAddress as `0x${string}`)) {
          fail("invalid_payer", "payerAddress is not a valid Sui address");
        }
        return normalizeSuiAddress(input.payerAddress as `0x${string}`) as `0x${string}`;
      })()
    : undefined;

  const partial: Omit<QrFerryEnvelope, "checksum"> = {
    version: ENVELOPE_VERSION,
    item: input.item,
    quantity: input.quantity,
    totalMist: input.totalMist.toString(),
    merchantAddress,
    payerAddress,
    nonce: input.nonce,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  const checksum = computeChecksum(partial);
  return { ...partial, checksum };
}

/** Verify checksum + timestamps against `now`. Does not touch the registry. */
export function verifyEnvelope(
  env: QrFerryEnvelope,
  opts: { now?: number } = {},
): true {
  const now = opts.now ?? Date.now();

  if (env.version !== ENVELOPE_VERSION) {
    fail("unsupported_version", `version ${env.version}`);
  }
  if (!isValidSuiAddress(env.merchantAddress)) {
    fail("invalid_merchant", "merchantAddress invalid");
  }
  // The checksum binds exactly one address representation. Reject valid but
  // noncanonical encodings (0X prefix, uppercase hex) so a single canonical
  // form is the only one that can carry a valid checksum. createEnvelope
  // normalizes on mint; verify/import must enforce the same canonical form.
  if (normalizeSuiAddress(env.merchantAddress) !== env.merchantAddress) {
    fail("invalid_merchant", "merchantAddress must be canonical (0x + 64 lowercase hex)");
  }
  if (env.payerAddress !== undefined) {
    if (!isValidSuiAddress(env.payerAddress)) {
      fail("invalid_payer", "payerAddress invalid");
    }
    if (normalizeSuiAddress(env.payerAddress) !== env.payerAddress) {
      fail("invalid_payer", "payerAddress must be canonical (0x + 64 lowercase hex)");
    }
  }
  let totalMist: bigint;
  try {
    totalMist = BigInt(env.totalMist);
  } catch {
    fail("invalid_amount", "totalMist not a bigint string");
  }
  if (totalMist <= 0n || totalMist > MAX_TOTAL_MIST) {
    fail("invalid_amount", "totalMist out of bounds");
  }
  if (!Number.isInteger(env.quantity) || env.quantity <= 0) {
    fail("invalid_quantity", "quantity must be positive integer");
  }
  if (env.quantity > MAX_QUANTITY) {
    fail("invalid_quantity", `quantity exceeds ${MAX_QUANTITY}`);
  }
  if (typeof env.item !== "string" || env.item.length === 0) {
    fail("invalid_item", "item empty");
  }
  if (env.item.length > MAX_ITEM_LENGTH) {
    fail("invalid_item", `item exceeds ${MAX_ITEM_LENGTH} chars`);
  }
  rejectDelimiterInjection("invalid_item", "item", env.item);
  if (typeof env.nonce !== "string" || env.nonce.length === 0) {
    fail("invalid_nonce", "nonce empty");
  }
  if (env.nonce.length > MAX_NONCE_LENGTH) {
    fail("invalid_nonce", `nonce exceeds ${MAX_NONCE_LENGTH} chars`);
  }
  rejectDelimiterInjection("invalid_nonce", "nonce", env.nonce);
  if (!Number.isInteger(env.createdAt) || !Number.isInteger(env.expiresAt)) {
    fail("invalid_timestamps", "timestamps not integer ms");
  }
  if (env.expiresAt <= env.createdAt) {
    fail("invalid_timestamps", "expiresAt not after createdAt");
  }
  if (env.expiresAt - env.createdAt > MAX_EXPIRY_WINDOW_MS) {
    fail("invalid_timestamps", "expiry window exceeds cap");
  }
  if (now > env.expiresAt) {
    fail("expired", `now=${now} > expiresAt=${env.expiresAt}`);
  }
  if (env.createdAt > now + CLOCK_SKEW_MS) {
    fail("future", `createdAt=${env.createdAt} > now+skew=${now + CLOCK_SKEW_MS}`);
  }

  const expected = computeChecksum({
    version: env.version,
    item: env.item,
    quantity: env.quantity,
    totalMist: env.totalMist,
    merchantAddress: env.merchantAddress,
    payerAddress: env.payerAddress,
    nonce: env.nonce,
    createdAt: env.createdAt,
    expiresAt: env.expiresAt,
  });
  if (expected !== env.checksum) {
    fail("checksum_mismatch", "canonical checksum does not match");
  }
  return true;
}

/** Serialize an envelope to deterministic JSON for QR transport. */
export function exportEnvelopeJson(env: QrFerryEnvelope): string {
  // Fixed key order for stable wire bytes; matches CANONICAL_KEYS plus checksum.
  const obj: Record<string, unknown> = {};
  for (const key of CANONICAL_KEYS) {
    obj[key] = (env as unknown as Record<string, unknown>)[key];
  }
  obj.checksum = env.checksum;
  return JSON.stringify(obj);
}

function parseEnvelopeObject(obj: unknown): QrFerryEnvelope {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    fail("invalid_shape", "envelope must be a JSON object");
  }
  const o = obj as Record<string, unknown>;
  const version = o.version;
  if (version !== ENVELOPE_VERSION) {
    fail("unsupported_version", `version=${String(version)}`);
  }
  if (typeof o.item !== "string") fail("invalid_shape", "item missing");
  if (typeof o.quantity !== "number") fail("invalid_shape", "quantity missing");
  if (typeof o.totalMist !== "string") fail("invalid_shape", "totalMist missing");
  if (typeof o.merchantAddress !== "string") fail("invalid_shape", "merchantAddress missing");
  if (o.payerAddress !== undefined && typeof o.payerAddress !== "string") {
    fail("invalid_shape", "payerAddress must be string or absent");
  }
  if (typeof o.nonce !== "string") fail("invalid_shape", "nonce missing");
  if (typeof o.createdAt !== "number") fail("invalid_shape", "createdAt missing");
  if (typeof o.expiresAt !== "number") fail("invalid_shape", "expiresAt missing");
  if (typeof o.checksum !== "string") fail("invalid_shape", "checksum missing");

  return {
    version,
    item: o.item,
    quantity: o.quantity,
    totalMist: o.totalMist,
    merchantAddress: o.merchantAddress as `0x${string}`,
    payerAddress: o.payerAddress as `0x${string}` | undefined,
    nonce: o.nonce,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    checksum: o.checksum as `0x${string}`,
  };
}

export interface ImportOptions {
  now?: number;
  registry?: ReplayRegistry;
}

/**
 * Import + verify a transported envelope JSON. Verifies shape, checksum,
 * timestamps, and (when a registry is supplied) consumes the nonce exactly
 * once. The nonce is only consumed after all other checks pass, so a failed
 * import never burns a nonce.
 */
export function importEnvelope(json: string, opts: ImportOptions = {}): QrFerryEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("malformed_json", "input is not valid JSON");
  }
  if (parsed === null) fail("malformed_json", "null payload");

  const env = parseEnvelopeObject(parsed);
  // verifyEnvelope throws on any structural/temporal/checksum problem.
  verifyEnvelope(env, { now: opts.now });

  if (opts.registry) {
    if (!opts.registry.tryConsume(env.nonce)) {
      fail("duplicate_nonce", `nonce already consumed: ${env.nonce}`);
    }
  }
  return env;
}
