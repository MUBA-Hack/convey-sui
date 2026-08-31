// Shared test fixtures for the portfolio position + brief suites.
//
// Two layers:
//   1. Lightweight plan/receipt/purchase builders (makePlanContent, makeReceipt,
//      makeEntry, entryAt) feed the pure paired-input test seam in
//      portfolio.server.ts. These do NOT exercise the Base verifier.
//   2. A real ethers-encoded verified-evidence tuple (buildVerifiedEvidence)
//      plus setVerifiedReader wires `verifyProtectionPurchaseOnBase` to return
//      a "verified" response for a given plan, so the production
//      `buildProtectionPositionBook` orchestration can be tested end-to-end via
//      the existing verifier reader seam.
//
// This module is test-only: it imports the verifier's test reader hook and
// ethers ABI helpers, and lives under tests/ so production code cannot depend
// on it.

import { OPTION_BOOK_ABI, getChainConfigById } from "@thetanuts-finance/thetanuts-client";
import { Interface, ZeroAddress, keccak256 } from "ethers";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";
import {
  buildProtectionPurchaseReceipt,
  type ProtectionPurchaseReceiptDocument,
  type VerifiedProtectionPurchase,
} from "@/lib/strategy/protection-purchase-receipt";
import {
  __setProtectionPurchaseVerificationReaderFactoryForTest,
  evaluateProtectionPurchaseVerification,
  type ProtectionPurchaseTransaction,
  type ProtectionPurchaseTransactionReceipt,
  type ProtectionPurchaseVerificationReader,
} from "@/lib/strategy/protection-purchase-verification.server";
import { POSITION_EXPIRING_WINDOW_SECONDS } from "@/lib/strategy/portfolio";

// --- Lightweight plan/receipt/purchase builders (pure, no verifier) --------

export const ACCOUNT = "0x" + "11".repeat(20);
export const MAKER = "0x" + "44".repeat(20);
export const OPTION_BOOK = "0x" + "22".repeat(20);
export const COLLATERAL = "0x" + "33".repeat(20);
export const REFERRER = "0x" + "55".repeat(20);
export const OPTION = "0x" + "66".repeat(20);
export const ORDER_FP = "0x" + "ab".repeat(32);
export const SIG_HASH = "0x" + "cd".repeat(32);
export const FILL_HASH = "0x" + "ef".repeat(32);
export const TX_HASH = "0x" + "0a".repeat(32);

export const EXPIRY_SECONDS = 1_800_000_000n;
export const EXPIRY_MS = EXPIRY_SECONDS * 1000n;
export const WINDOW_MS = POSITION_EXPIRING_WINDOW_SECONDS * 1000n;
export const FLOOR = "200000000000";
export const NOW_MS = 1_700_000_000_000; // deterministic, well before expiry window

export function first<T>(arr: readonly T[]): T {
  return arr[0] as T;
}
export function nth<T>(arr: readonly T[], i: number): T {
  return arr[i] as T;
}

export interface PlanOverrides {
  asset?: "ETH" | "BTC";
  expirySeconds?: string;
  strikes8d?: string[];
  estimatedPremiumMicro?: string;
  premiumCapMicro?: string;
  allowanceAmountMicro?: string;
  numContractsMicro?: string;
  pricePerContract8d?: string;
  nonce?: string;
  account?: string;
  maker?: string;
  referrer?: string;
  issuedAt?: string;
  validUntil?: string;
  orderFingerprint?: string;
  signatureHash?: string;
  fillDataHash?: string;
}

export function makePlanContent(overrides: PlanOverrides = {}): ProtectionPurchasePlanContent {
  const estimatedPremiumMicro = overrides.estimatedPremiumMicro ?? "2000000";
  const premiumCapMicro = overrides.premiumCapMicro ?? "2000000";
  const allowanceAmountMicro = overrides.allowanceAmountMicro ?? "2000000";
  const numContractsMicro = overrides.numContractsMicro ?? "2000000";
  const pricePerContract8d = overrides.pricePerContract8d ?? "100000000";
  return {
    version: 1,
    issuedAt: overrides.issuedAt ?? "2026-01-01T00:00:00.000Z",
    validUntil: overrides.validUntil ?? "2026-01-02T00:00:00.000Z",
    chainId: 8453,
    account: overrides.account ?? ACCOUNT,
    asset: overrides.asset ?? "ETH",
    orderFingerprint: ORDER_FP,
    signatureHash: SIG_HASH,
    optionBook: OPTION_BOOK,
    collateralToken: COLLATERAL,
    maker: overrides.maker ?? MAKER,
    nonce: overrides.nonce ?? "1",
    signedOrderExpirySeconds: "3600",
    expirySeconds: overrides.expirySeconds ?? "1800000000",
    strikes8d: overrides.strikes8d ?? ["200000000000"],
    pricePerContract8d,
    premiumCapMicro,
    estimatedPremiumMicro,
    allowanceAmountMicro,
    numContractsMicro,
    referrer: overrides.referrer ?? REFERRER,
    fillDataHash: FILL_HASH,
  };
}

export function makePlanSummary(overrides: PlanOverrides = {}): ProtectionPurchasePlanSummary {
  const content = makePlanContent(overrides);
  const planId = buildProtectionPurchasePlanId(content);
  return { ...content, planId };
}

export interface ReceiptOverrides extends PlanOverrides {
  txHash?: string;
  blockNumber?: number;
  optionAddress?: string;
  feeCollectedMicro?: string;
  referralFeePaidMicro?: string;
  approvalTxHash?: string | null;
  exportedAt?: string;
  checkedAt?: string;
}

export function makePurchase(overrides: ReceiptOverrides = {}): VerifiedProtectionPurchase {
  const plan = makePlanSummary(overrides);
  return {
    kind: "verified",
    network: "base-mainnet",
    chainId: 8453,
    txHash: overrides.txHash ?? TX_HASH,
    blockNumber: overrides.blockNumber ?? 1000,
    buyerAddress: plan.account,
    makerAddress: plan.maker,
    optionAddress: overrides.optionAddress ?? OPTION,
    nonce: plan.nonce,
    premiumAmountMicro: plan.estimatedPremiumMicro,
    feeCollectedMicro: overrides.feeCollectedMicro ?? "0",
    referralFeePaidMicro: overrides.referralFeePaidMicro ?? "0",
    referrerAddress: plan.referrer,
    sellerWasMaker: true,
    checkedAt: overrides.checkedAt ?? "2026-01-01T12:00:00.000Z",
  };
}

export function makeReceipt(overrides: ReceiptOverrides = {}): ProtectionPurchaseReceiptDocument {
  const plan = makePlanSummary(overrides);
  const purchase = makePurchase(overrides);
  return buildProtectionPurchaseReceipt({
    plan,
    purchase,
    approvalTxHash: overrides.approvalTxHash ?? null,
    exportedAt: overrides.exportedAt ?? "2026-01-01T13:00:00.000Z",
  });
}

export interface ProtectionPositionIngestionEntry {
  readonly receipt: unknown;
  readonly verify: unknown;
}

export function makeEntry(
  receiptOverrides: ReceiptOverrides = {},
  verifyOverride?: unknown,
): ProtectionPositionIngestionEntry {
  return {
    receipt: makeReceipt(receiptOverrides),
    verify: verifyOverride ?? makePurchase(receiptOverrides),
  };
}

// Pin receipt/verify checkedAt and exportedAt to the same nowMs so the entry is
// fresh relative to the builder's nowMs. Required because the builder enforces
// a deterministic freshness window on the verifier checkedAt.
export function entryAt(
  nowMs: number | bigint,
  overrides: ReceiptOverrides = {},
): ProtectionPositionIngestionEntry {
  const ms = typeof nowMs === "bigint" ? Number(nowMs) : nowMs;
  const iso = new Date(ms).toISOString();
  return makeEntry({ ...overrides, checkedAt: iso, exportedAt: iso });
}

// --- Real ethers-encoded verified evidence (for production-path tests) -----

const CHAIN_CONFIG = getChainConfigById(8453);
const VERIFIER_OPTION_BOOK = CHAIN_CONFIG.contracts.optionBook!.toLowerCase();
const VERIFIER_COLLATERAL = CHAIN_CONFIG.tokens.USDC!.address.toLowerCase();
const VERIFIER_PUT = CHAIN_CONFIG.implementations.PUT!.toLowerCase();
const VERIFIER_IFACE = new Interface(OPTION_BOOK_ABI);

const VERIFIER_ORDER = {
  maker: MAKER,
  orderExpiryTimestamp: 2_000_000_000n,
  collateral: VERIFIER_COLLATERAL,
  isCall: false,
  priceFeed: CHAIN_CONFIG.priceFeeds.ETH,
  implementation: VERIFIER_PUT,
  isLong: true,
  maxCollateralUsable: 10_000000n,
  strikes: [200_00000000n],
  expiry: 2_100_000_000n,
  price: 1_25000000n,
  numContracts: 2_000000n,
  extraOptionData: "0x",
};
const VERIFIER_SIGNATURE = "0x1234";
const VERIFIER_FILL_DATA = VERIFIER_IFACE.encodeFunctionData("fillOrder", [
  VERIFIER_ORDER,
  VERIFIER_SIGNATURE,
  ZeroAddress,
]);
const VERIFIER_TX_HASH = "0x" + "12".repeat(32);
const VERIFIER_BLOCK_NUMBER = 123;
const VERIFIER_BLOCK_TIMESTAMP_SECONDS = Math.floor(Date.parse("2026-08-31T00:00:20.000Z") / 1_000);
const VERIFIER_OPTION_ADDRESS = "0xcccccccccccccccccccccccccccccccccccccccc";

function verifierOrderFilledLog(): {
  address: string;
  topics: readonly string[];
  data: string;
} {
  const encoded = VERIFIER_IFACE.encodeEventLog(VERIFIER_IFACE.getEvent("OrderFilled")!, [
    7n, // nonce
    ACCOUNT, // buyer
    MAKER, // seller
    VERIFIER_OPTION_ADDRESS,
    2_500000n, // premiumAmount
    10_000n, // feeCollected
    ZeroAddress, // referrer
    0n, // referralFeePaid
    true, // sellerWasMaker
  ]);
  return { address: VERIFIER_OPTION_BOOK, topics: encoded.topics, data: encoded.data };
}

export interface VerifiedEvidence {
  readonly plan: ProtectionPurchasePlanSummary;
  readonly transaction: ProtectionPurchaseTransaction;
  readonly txReceipt: ProtectionPurchaseTransactionReceipt;
  readonly blockTimestampSeconds: number;
  readonly checkedAt: string;
  readonly verifiedResponse: VerifiedProtectionPurchase;
}

// Build a self-consistent (plan, transaction, receipt, block timestamp) tuple
// that `evaluateProtectionPurchaseVerification` accepts as "verified", plus the
// exact verified response it produces. The plan is derived from the encoded
// order so every immutable field lines up with the calldata and OrderFilled log.
export function buildVerifiedEvidence(): VerifiedEvidence {
  const content: ProtectionPurchasePlanContent = {
    version: 1,
    issuedAt: "2026-08-31T00:00:00.000Z",
    validUntil: "2026-08-31T00:00:30.000Z",
    chainId: 8453,
    account: ACCOUNT,
    asset: "ETH",
    orderFingerprint: "0x" + "31".repeat(32),
    signatureHash: keccak256(VERIFIER_SIGNATURE).toLowerCase(),
    optionBook: VERIFIER_OPTION_BOOK,
    collateralToken: VERIFIER_COLLATERAL,
    maker: MAKER,
    nonce: "7",
    signedOrderExpirySeconds: "2000000000",
    expirySeconds: "2100000000",
    strikes8d: ["20000000000"],
    pricePerContract8d: "125000000",
    premiumCapMicro: "3000000",
    estimatedPremiumMicro: "2500000",
    allowanceAmountMicro: "3000000",
    numContractsMicro: "2000000",
    referrer: ZeroAddress,
    fillDataHash: keccak256(VERIFIER_FILL_DATA).toLowerCase(),
  };
  const planId = buildProtectionPurchasePlanId(content);
  const plan: ProtectionPurchasePlanSummary = { ...content, planId };

  const transaction: ProtectionPurchaseTransaction = {
    hash: VERIFIER_TX_HASH,
    from: ACCOUNT,
    to: VERIFIER_OPTION_BOOK,
    data: VERIFIER_FILL_DATA,
    value: 0n,
    chainId: 8453n,
  };
  const txReceipt: ProtectionPurchaseTransactionReceipt = {
    hash: VERIFIER_TX_HASH,
    from: ACCOUNT,
    to: VERIFIER_OPTION_BOOK,
    status: 1,
    blockNumber: VERIFIER_BLOCK_NUMBER,
    logs: [verifierOrderFilledLog()],
  };
  const checkedAt = "2026-08-31T00:01:00.000Z";
  const verifiedResponse = evaluateProtectionPurchaseVerification({
    request: { txHash: VERIFIER_TX_HASH, plan },
    transaction,
    receipt: txReceipt,
    executionBlockTimestampSeconds: VERIFIER_BLOCK_TIMESTAMP_SECONDS,
    checkedAt,
  }) as VerifiedProtectionPurchase;
  return {
    plan,
    transaction,
    txReceipt,
    blockTimestampSeconds: VERIFIER_BLOCK_TIMESTAMP_SECONDS,
    checkedAt,
    verifiedResponse,
  };
}

// Wire the verifier reader seam to return evidence that verifies against
// `evidence.plan`. After this, `verifyProtectionPurchaseOnBase({txHash, plan})`
// returns "verified" only when txHash/plan match the evidence.
export function setVerifiedReader(evidence: VerifiedEvidence): void {
  const reader: ProtectionPurchaseVerificationReader = {
    getTransaction: async (hash) =>
      hash.toLowerCase() === evidence.transaction.hash.toLowerCase()
        ? evidence.transaction
        : null,
    getTransactionReceipt: async (hash) =>
      hash.toLowerCase() === evidence.txReceipt.hash.toLowerCase()
        ? evidence.txReceipt
        : null,
    getBlockTimestamp: async (blockNumber) =>
      blockNumber === evidence.txReceipt.blockNumber ? evidence.blockTimestampSeconds : null,
  };
  __setProtectionPurchaseVerificationReaderFactoryForTest(() => reader);
}

// Wire the verifier reader seam to return no evidence (pending) for any hash.
export function setPendingReader(): void {
  __setProtectionPurchaseVerificationReaderFactoryForTest(() => ({
    getTransaction: async () => null,
    getTransactionReceipt: async () => null,
    getBlockTimestamp: async () => null,
  }));
}

export function clearVerifierReader(): void {
  __setProtectionPurchaseVerificationReaderFactoryForTest(null);
}

// Build a portable receipt document bound to the verified evidence, with
// checkedAt pinned to the evidence's verified checkedAt so the portfolio
// server's freshness window accepts it when nowMs is within range.
export function makeVerifiedReceiptDoc(
  evidence: VerifiedEvidence,
  overrides: { exportedAt?: string; approvalTxHash?: string | null } = {},
): ProtectionPurchaseReceiptDocument {
  return buildProtectionPurchaseReceipt({
    plan: evidence.plan,
    purchase: evidence.verifiedResponse,
    approvalTxHash: overrides.approvalTxHash ?? null,
    exportedAt: overrides.exportedAt ?? evidence.checkedAt,
  });
}

// Clone a verified evidence tuple with a different txHash. The plan content
// stays identical (planId is derived from plan fields, not txHash); only the
// transaction/receipt hash and the re-evaluated verified response change. This
// lets production-path tests build multiple distinct txHashes that all verify
// without re-encoding ethers calldata.
export function cloneVerifiedEvidenceWithTxHash(
  base: VerifiedEvidence,
  txHash: string,
): VerifiedEvidence {
  const transaction: ProtectionPurchaseTransaction = { ...base.transaction, hash: txHash };
  const txReceipt: ProtectionPurchaseTransactionReceipt = { ...base.txReceipt, hash: txHash };
  const verifiedResponse = evaluateProtectionPurchaseVerification({
    request: { txHash, plan: base.plan },
    transaction,
    receipt: txReceipt,
    executionBlockTimestampSeconds: base.blockTimestampSeconds,
    checkedAt: base.checkedAt,
  }) as VerifiedProtectionPurchase;
  return {
    plan: base.plan,
    transaction,
    txReceipt,
    blockTimestampSeconds: base.blockTimestampSeconds,
    checkedAt: base.checkedAt,
    verifiedResponse,
  };
}

// Wire the verifier reader seam to return evidence for multiple txHashes. Each
// txHash maps to its own evidence tuple. An optional delayMs per hash lets
// tests exercise concurrent resolution order. Unknown hashes return null
// (pending).
export function setMultiVerifiedReader(
  evidences: ReadonlyArray<VerifiedEvidence>,
  delays: ReadonlyMap<string, number> = new Map(),
): void {
  const byHash = new Map<string, VerifiedEvidence>();
  for (const ev of evidences) {
    byHash.set(ev.transaction.hash.toLowerCase(), ev);
  }
  const reader: ProtectionPurchaseVerificationReader = {
    getTransaction: async (hash) => {
      const ev = byHash.get(hash.toLowerCase());
      if (ev === undefined) return null;
      const delay = delays.get(ev.transaction.hash.toLowerCase());
      if (delay !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      return ev.transaction;
    },
    getTransactionReceipt: async (hash) => {
      const ev = byHash.get(hash.toLowerCase());
      if (ev === undefined) return null;
      return ev.txReceipt;
    },
    getBlockTimestamp: async (blockNumber) => {
      for (const ev of byHash.values()) {
        if (ev.txReceipt.blockNumber === blockNumber) return ev.blockTimestampSeconds;
      }
      return null;
    },
  };
  __setProtectionPurchaseVerificationReaderFactoryForTest(() => reader);
}
