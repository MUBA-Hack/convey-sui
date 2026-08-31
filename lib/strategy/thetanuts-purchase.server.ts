import "server-only";

import {
  ThetanutsClient,
  type OrderWithSignature,
} from "@thetanuts-finance/thetanuts-client";
import {
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  ZeroAddress,
} from "ethers";
import {
  createBaseThetanutsClient,
  requireBaseOptionBook,
} from "@/lib/strategy/thetanuts-base.server";
import {
  buildProtectionOrderFingerprint,
  buildProtectionPurchasePlanId,
  buildProtectionSignatureHash,
  PROTECTION_PURCHASE_CHAIN_ID,
  PROTECTION_PURCHASE_CHAIN_ID_HEX,
  PROTECTION_PURCHASE_VERSION,
  ProtectionPurchasePlanContentSchema,
  ProtectionPurchasePlanRequestSchema,
  ProtectionPurchasePlanResponseSchema,
  type ProtectionPurchasePlanContent,
  type ProtectionPurchasePlanRequest,
  type ProtectionPurchasePlanResponse,
  type ProtectionPurchaseTransaction,
} from "@/lib/strategy/protection-purchase";
import { parseStrategyGoal, type StrategyAsset } from "@/lib/strategy/intent";
import {
  parsePreviewEconomics,
  premiumBudgetUsdToMicro,
} from "@/lib/strategy/shield-recommendation";

const MAX_ORDERS_INSPECTED = 200;
const DEFAULT_TIMEOUT_MS = 6_000;
const PLAN_LIFETIME_MS = 30_000;
const MINIMUM_SUBMIT_RUNWAY_SECONDS = 15;
const EXPIRY_GUARD_MS = 5_000;
const EIGHT_DECIMALS = 100_000_000n;
export const PROTECTION_PURCHASE_REFERRER = ZeroAddress;

type Preview = ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>;

export interface ThetanutsPurchaseReader {
  optionBook: string;
  collateralToken: string;
  putImplementation: string;
  priceFeeds: Record<StrategyAsset, string>;
  fetchOrders(): Promise<OrderWithSignature[]>;
  previewFillOrder(order: OrderWithSignature, premiumCapMicro: bigint, referrer: string): Preview;
  getAllowance(token: string, owner: string, spender: string): Promise<bigint>;
  encodeApprove(token: string, spender: string, amount: bigint): { to: string; data: string };
  encodeFillOrder(order: OrderWithSignature, premiumCapMicro: bigint, referrer: string): { to: string; data: string };
}

export interface PrepareProtectionPurchaseOptions {
  nowMs: number;
  timeoutMs?: number;
}

function checkedAt(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function addressEquals(left: string | undefined, right: string): boolean {
  return typeof left === "string" && isAddress(left) && left.toLowerCase() === right.toLowerCase();
}

function sameBigints(left: bigint[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  try {
    return left.every((value, index) => value > 0n && value === BigInt(right[index] ?? ""));
  } catch {
    return false;
  }
}

function hasValidOrderShape(
  entry: OrderWithSignature,
  reader: ThetanutsPurchaseReader,
  asset: StrategyAsset,
  account: string,
  nowSeconds: number,
  minimumExpirySeconds: number,
): boolean {
  const raw = entry.rawApiData;
  if (!raw) return false;
  if (!addressEquals(entry.order.maker, entry.makerAddress)) return false;
  if (!addressEquals(entry.order.collateralToken, reader.collateralToken)) return false;
  if (!addressEquals(raw.collateral, reader.collateralToken)) return false;
  if (!addressEquals(raw.priceFeed, reader.priceFeeds[asset])) return false;
  if (!addressEquals(raw.implementation, reader.putImplementation)) return false;
  if (raw.optionBookAddress && !addressEquals(raw.optionBookAddress, reader.optionBook)) return false;
  if (entry.order.isBuyer || entry.order.optionType !== 1 || raw.isCall || !raw.isLong) return false;
  if (!addressEquals(entry.order.taker, ZeroAddress) && !addressEquals(entry.order.taker, account)) return false;
  if (!sameBigints(entry.order.strikes, raw.strikes) || raw.strikes.length !== 1) return false;
  if (entry.order.price <= 0n || entry.availableAmount <= 0n || entry.order.nonce < 0n) return false;
  if (entry.order.expiry > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) return false;
  if (entry.order.expiry < BigInt(minimumExpirySeconds) || entry.order.expiry <= BigInt(nowSeconds)) return false;
  if (!Number.isSafeInteger(raw.orderExpiryTimestamp)) return false;
  if (raw.orderExpiryTimestamp - nowSeconds < MINIMUM_SUBMIT_RUNWAY_SECONDS) return false;
  if (BigInt(raw.orderExpiryTimestamp) > entry.order.expiry) return false;
  if (!/^[1-9]\d*$/.test(raw.maxCollateralUsable) || BigInt(raw.maxCollateralUsable) !== entry.availableAmount) return false;
  if (!isHexString(entry.signature) || entry.signature === "0x") return false;
  if (raw.extraOptionData !== "0x") return false;
  return true;
}

function findExactOrder(
  orders: OrderWithSignature[],
  fingerprint: string,
  optionBook: string,
): OrderWithSignature | null {
  for (const entry of orders.slice(0, MAX_ORDERS_INSPECTED)) {
    try {
      if (buildProtectionOrderFingerprint(entry, optionBook) === fingerprint) return entry;
    } catch {
      continue;
    }
  }
  return null;
}

function validatePreview(
  preview: Preview,
  entry: OrderWithSignature,
  premiumCapMicro: bigint,
): { numContracts: bigint; estimatedPremiumMicro: bigint } | null {
  const strikes = entry.order.strikes ?? [];
  const parsed = parsePreviewEconomics(preview, {
    makerAddress: entry.makerAddress,
    expiry: entry.order.expiry,
    isCall: false,
    strikes,
    pricePerContract8d: entry.order.price,
  });
  if (!parsed || parsed.totalCollateral !== premiumCapMicro) return null;
  const requestedContracts = premiumCapMicro * EIGHT_DECIMALS / entry.order.price;
  if (requestedContracts <= 0n || requestedContracts > preview.maxContracts) return null;
  if (parsed.numContracts !== requestedContracts) return null;
  const estimatedPremiumMicro = requestedContracts * entry.order.price / EIGHT_DECIMALS;
  if (estimatedPremiumMicro <= 0n || estimatedPremiumMicro > premiumCapMicro) return null;
  return { numContracts: requestedContracts, estimatedPremiumMicro };
}

function transaction(from: string, to: string, data: string): ProtectionPurchaseTransaction {
  return {
    from: getAddress(from).toLowerCase(),
    to: getAddress(to).toLowerCase(),
    data,
    value: "0x0",
    chainId: PROTECTION_PURCHASE_CHAIN_ID_HEX,
  };
}

function buildPlan(
  request: ProtectionPurchasePlanRequest,
  reader: ThetanutsPurchaseReader,
  entry: OrderWithSignature,
  asset: StrategyAsset,
  premiumCapMicro: bigint,
  numContracts: bigint,
  estimatedPremiumMicro: bigint,
  fillData: string,
  nowMs: number,
): ProtectionPurchasePlanContent {
  const raw = entry.rawApiData!;
  const validUntilMs = Math.min(
    nowMs + PLAN_LIFETIME_MS,
    raw.orderExpiryTimestamp * 1_000 - EXPIRY_GUARD_MS,
    Number(entry.order.expiry) * 1_000 - EXPIRY_GUARD_MS,
  );
  return ProtectionPurchasePlanContentSchema.parse({
    version: PROTECTION_PURCHASE_VERSION,
    issuedAt: checkedAt(nowMs),
    validUntil: checkedAt(validUntilMs),
    chainId: PROTECTION_PURCHASE_CHAIN_ID,
    account: request.account,
    asset,
    orderFingerprint: request.offerFingerprint,
    signatureHash: buildProtectionSignatureHash(entry.signature),
    optionBook: reader.optionBook,
    collateralToken: reader.collateralToken,
    maker: entry.makerAddress,
    nonce: entry.order.nonce.toString(),
    signedOrderExpirySeconds: raw.orderExpiryTimestamp.toString(),
    expirySeconds: entry.order.expiry.toString(),
    strikes8d: raw.strikes,
    pricePerContract8d: entry.order.price.toString(),
    premiumCapMicro: premiumCapMicro.toString(),
    estimatedPremiumMicro: estimatedPremiumMicro.toString(),
    allowanceAmountMicro: premiumCapMicro.toString(),
    numContractsMicro: numContracts.toString(),
    referrer: PROTECTION_PURCHASE_REFERRER,
    fillDataHash: keccak256(fillData).toLowerCase(),
  });
}

async function prepareWithinBudget(
  reader: ThetanutsPurchaseReader,
  request: ProtectionPurchasePlanRequest,
  options: PrepareProtectionPurchaseOptions,
): Promise<ProtectionPurchasePlanResponse> {
  const at = checkedAt(options.nowMs);
  const intent = parseStrategyGoal(request.goal);
  if (intent.kind !== "strategy" || intent.objective !== "protect_downside" || intent.horizonDays === null) {
    return { kind: "rejected", reason: "unsupported_goal", checkedAt: at };
  }
  const orders = await reader.fetchOrders();
  if (!Array.isArray(orders)) return { kind: "unavailable", checkedAt: at };
  const entry = findExactOrder(orders, request.offerFingerprint, reader.optionBook);
  if (!entry) return { kind: "changed", checkedAt: at };
  const nowSeconds = Math.floor(options.nowMs / 1_000);
  const minimumExpiry = nowSeconds + intent.horizonDays * 86_400;
  if (!hasValidOrderShape(entry, reader, intent.asset, request.account, nowSeconds, minimumExpiry)) {
    return { kind: "changed", checkedAt: at };
  }
  const premiumCapMicro = premiumBudgetUsdToMicro(request.premiumBudgetUsd);
  const rawPreview = reader.previewFillOrder(entry, premiumCapMicro, PROTECTION_PURCHASE_REFERRER);
  const preview = validatePreview(rawPreview, entry, premiumCapMicro);
  if (!preview) return { kind: "no_match", checkedAt: at };
  const fill = reader.encodeFillOrder(entry, premiumCapMicro, PROTECTION_PURCHASE_REFERRER);
  if (!addressEquals(fill.to, reader.optionBook) || !isHexString(fill.data)) {
    return { kind: "unavailable", checkedAt: at };
  }
  const content = buildPlan(
    request,
    reader,
    entry,
    intent.asset,
    premiumCapMicro,
    preview.numContracts,
    preview.estimatedPremiumMicro,
    fill.data,
    options.nowMs,
  );
  const plan = { ...content, planId: buildProtectionPurchasePlanId(content) };
  const allowance = await reader.getAllowance(reader.collateralToken, request.account, reader.optionBook);
  if (allowance < premiumCapMicro) {
    const approval = reader.encodeApprove(reader.collateralToken, reader.optionBook, premiumCapMicro);
    if (!addressEquals(approval.to, reader.collateralToken) || !isHexString(approval.data)) {
      return { kind: "unavailable", checkedAt: at };
    }
    return ProtectionPurchasePlanResponseSchema.parse({
      kind: "ready_approval",
      plan,
      transaction: transaction(request.account, approval.to, approval.data),
      checkedAt: at,
    });
  }
  return ProtectionPurchasePlanResponseSchema.parse({
    kind: "ready_fill",
    plan,
    transaction: transaction(request.account, fill.to, fill.data),
    checkedAt: at,
  });
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PURCHASE_TIMEOUT")), timeoutMs);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function prepareProtectionPurchasePlanWith(
  reader: ThetanutsPurchaseReader,
  input: unknown,
  options: PrepareProtectionPurchaseOptions,
): Promise<ProtectionPurchasePlanResponse> {
  const at = checkedAt(options.nowMs);
  const parsed = ProtectionPurchasePlanRequestSchema.safeParse(input);
  if (!parsed.success) return { kind: "rejected", reason: "invalid_request", checkedAt: at };
  try {
    return await withTimeout(
      prepareWithinBudget(reader, parsed.data, options),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch {
    return { kind: "unavailable", checkedAt: at };
  }
}

export function createThetanutsPurchaseReader(): ThetanutsPurchaseReader {
  const client = createBaseThetanutsClient();
  const optionBook = requireBaseOptionBook(client);
  const collateralToken = client.chainConfig.tokens.USDC?.address;
  const putImplementation = client.chainConfig.implementations.PUT;
  const ethFeed = client.chainConfig.priceFeeds.ETH;
  const btcFeed = client.chainConfig.priceFeeds.BTC;
  if (!collateralToken || !putImplementation || !ethFeed || !btcFeed) {
    throw new Error("Incomplete Base chain configuration.");
  }
  return {
    optionBook,
    collateralToken,
    putImplementation,
    priceFeeds: { ETH: ethFeed, BTC: btcFeed },
    fetchOrders: () => client.api.fetchOrders(),
    previewFillOrder: (order, amount, referrer) => client.optionBook.previewFillOrder(order, amount, referrer),
    getAllowance: (token, owner, spender) => client.erc20.getAllowance(token, owner, spender),
    encodeApprove: (token, spender, amount) => client.erc20.encodeApprove(token, spender, amount),
    encodeFillOrder: (order, amount, referrer) => client.optionBook.encodeFillOrder(order, amount, referrer),
  };
}

export function prepareProtectionPurchasePlan(
  input: unknown,
  options: PrepareProtectionPurchaseOptions,
): Promise<ProtectionPurchasePlanResponse> {
  return prepareProtectionPurchasePlanWith(createThetanutsPurchaseReader(), input, options);
}
