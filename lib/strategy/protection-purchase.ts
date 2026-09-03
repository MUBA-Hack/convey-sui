import { isAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { z } from "zod";
import { MAX_STRATEGY_GOAL_LENGTH } from "@/lib/strategy/intent";

export const PROTECTION_PURCHASE_CHAIN_ID = 8453 as const;
export const PROTECTION_PURCHASE_CHAIN_ID_HEX = "0x2105" as const;
export const PROTECTION_PURCHASE_VERSION = 1 as const;
export const PROTECTION_PURCHASE_MAX_BODY_BYTES = 4_096;
export const PROTECTION_PURCHASE_MIN_PREMIUM_USD = 0.000001;
export const PROTECTION_PURCHASE_MAX_PREMIUM_USD = 3;
export const PROTECTION_PURCHASE_MIN_PREMIUM_MICRO = 1n;
export const PROTECTION_PURCHASE_MAX_PREMIUM_MICRO = 3_000_000n;
const PRICE_SCALE_8D = 100_000_000n;

const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const DecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const PositiveDecimalSchema = z.string().regex(/^[1-9]\d*$/);
const HexDataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const EvmAddressSchema = z
  .string()
  .refine(isAddress, "invalid EVM address")
  .transform((value) => value.toLowerCase());
const AssetSchema = z.enum(["ETH", "BTC"]);

function isPurchaseBudget(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < PROTECTION_PURCHASE_MIN_PREMIUM_USD || value > PROTECTION_PURCHASE_MAX_PREMIUM_USD) return false;
  return Number.isSafeInteger(value * 1_000_000);
}

export const ProtectionPurchasePlanRequestSchema = z
  .object({
    goal: z.string().min(1).max(MAX_STRATEGY_GOAL_LENGTH),
    premiumBudgetUsd: z.number().refine(isPurchaseBudget),
    account: EvmAddressSchema,
    offerFingerprint: HashSchema,
  })
  .strict();

export const ProtectionPurchaseTransactionSchema = z
  .object({
    to: EvmAddressSchema,
    from: EvmAddressSchema,
    data: HexDataSchema,
    value: z.literal("0x0"),
    chainId: z.literal(PROTECTION_PURCHASE_CHAIN_ID_HEX),
  })
  .strict();

const ProtectionPurchasePlanContentShapeSchema = z
  .object({
    version: z.literal(PROTECTION_PURCHASE_VERSION),
    issuedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    chainId: z.literal(PROTECTION_PURCHASE_CHAIN_ID),
    account: EvmAddressSchema,
    asset: AssetSchema,
    orderFingerprint: HashSchema,
    signatureHash: HashSchema,
    optionBook: EvmAddressSchema,
    collateralToken: EvmAddressSchema,
    maker: EvmAddressSchema,
    nonce: DecimalSchema,
    signedOrderExpirySeconds: PositiveDecimalSchema,
    expirySeconds: PositiveDecimalSchema,
    strikes8d: z.array(PositiveDecimalSchema).min(1).max(4),
    pricePerContract8d: PositiveDecimalSchema,
    premiumCapMicro: PositiveDecimalSchema,
    estimatedPremiumMicro: PositiveDecimalSchema,
    allowanceAmountMicro: PositiveDecimalSchema,
    numContractsMicro: PositiveDecimalSchema,
    referrer: EvmAddressSchema,
    fillDataHash: HashSchema,
  })
  .strict();

type ProtectionPurchaseEconomics = Pick<
  z.infer<typeof ProtectionPurchasePlanContentShapeSchema>,
  | "pricePerContract8d"
  | "premiumCapMicro"
  | "estimatedPremiumMicro"
  | "allowanceAmountMicro"
  | "numContractsMicro"
>;

export function hasValidProtectionPurchaseEconomics(
  plan: ProtectionPurchaseEconomics,
): boolean {
  try {
    const pricePerContract8d = BigInt(plan.pricePerContract8d);
    const premiumCapMicro = BigInt(plan.premiumCapMicro);
    const estimatedPremiumMicro = BigInt(plan.estimatedPremiumMicro);
    const allowanceAmountMicro = BigInt(plan.allowanceAmountMicro);
    const numContractsMicro = BigInt(plan.numContractsMicro);
    return (
      premiumCapMicro >= PROTECTION_PURCHASE_MIN_PREMIUM_MICRO &&
      premiumCapMicro <= PROTECTION_PURCHASE_MAX_PREMIUM_MICRO &&
      allowanceAmountMicro === premiumCapMicro &&
      estimatedPremiumMicro > 0n &&
      estimatedPremiumMicro <= premiumCapMicro &&
      numContractsMicro > 0n &&
      numContractsMicro * pricePerContract8d / PRICE_SCALE_8D === estimatedPremiumMicro
    );
  } catch {
    return false;
  }
}

function addProtectionPurchaseEconomicsIssue(
  plan: ProtectionPurchaseEconomics,
  context: z.RefinementCtx,
): void {
  if (!hasValidProtectionPurchaseEconomics(plan)) {
    context.addIssue({
      code: "custom",
      path: ["estimatedPremiumMicro"],
      message: "plan economics are inconsistent",
    });
  }
}

export const ProtectionPurchasePlanContentSchema =
  ProtectionPurchasePlanContentShapeSchema.superRefine(
    addProtectionPurchaseEconomicsIssue,
  );

const ProtectionPurchasePlanSummaryShapeSchema = ProtectionPurchasePlanContentShapeSchema
  .extend({ planId: HashSchema })
  .strict();

export const ProtectionPurchasePlanSummarySchema = ProtectionPurchasePlanSummaryShapeSchema
  .superRefine((plan, context) => {
    addProtectionPurchaseEconomicsIssue(plan, context);
    const issuedAt = Date.parse(plan.issuedAt);
    const validUntil = Date.parse(plan.validUntil);
    if (validUntil <= issuedAt) {
      context.addIssue({ code: "custom", path: ["validUntil"], message: "plan is not fresh" });
    }
    const { planId, ...content } = plan;
    if (planId !== hashProtectionPurchasePlanContent(content)) {
      context.addIssue({ code: "custom", path: ["planId"], message: "plan content hash mismatch" });
    }
  });

const CheckedAtSchema = z.object({ checkedAt: z.string().datetime({ offset: true }) });
const ReadyBaseSchema = z.object({
  plan: ProtectionPurchasePlanSummarySchema,
  transaction: ProtectionPurchaseTransactionSchema,
  checkedAt: z.string().datetime({ offset: true }),
});

export const ProtectionPurchasePlanResponseSchema = z.discriminatedUnion("kind", [
  ReadyBaseSchema.extend({ kind: z.literal("ready_approval") }).strict(),
  ReadyBaseSchema.extend({ kind: z.literal("ready_fill") }).strict(),
  CheckedAtSchema.extend({ kind: z.literal("changed") }).strict(),
  CheckedAtSchema.extend({ kind: z.literal("no_match") }).strict(),
  CheckedAtSchema.extend({ kind: z.literal("unavailable") }).strict(),
  CheckedAtSchema.extend({
    kind: z.literal("rejected"),
    reason: z.enum(["invalid_request", "unsupported_goal"]),
  }).strict(),
]);

export type ProtectionPurchasePlanRequest = z.infer<typeof ProtectionPurchasePlanRequestSchema>;
export type ProtectionPurchaseTransaction = z.infer<typeof ProtectionPurchaseTransactionSchema>;
export type ProtectionPurchasePlanContent = z.infer<typeof ProtectionPurchasePlanContentSchema>;
export type ProtectionPurchasePlanSummary = z.infer<typeof ProtectionPurchasePlanSummarySchema>;
export type ProtectionPurchasePlanResponse = z.infer<typeof ProtectionPurchasePlanResponseSchema>;

function addressOrEmpty(value: string): string {
  if (value === "") return "";
  if (!isAddress(value)) throw new Error("Invalid order address.");
  return value.toLowerCase();
}

function optionalAddress(value: string | undefined): string | null {
  return value === undefined ? null : addressOrEmpty(value);
}

function optionalDecimal(value: bigint | undefined): string | null {
  return value === undefined ? null : value.toString();
}

export function buildProtectionOrderFingerprint(
  entry: OrderWithSignature,
  canonicalOptionBook: string,
): string {
  const raw = entry.rawApiData;
  if (!raw || !isHexString(entry.signature) || !isHexString(raw.extraOptionData || "0x")) {
    throw new Error("Malformed signed order.");
  }
  const canonical = [
    "convey-protection-order-v1",
    addressOrEmpty(canonicalOptionBook),
    addressOrEmpty(entry.order.maker),
    addressOrEmpty(entry.order.taker),
    addressOrEmpty(entry.order.option),
    entry.order.isBuyer,
    entry.order.numContracts.toString(),
    entry.order.price.toString(),
    entry.order.expiry.toString(),
    entry.order.nonce.toString(),
    entry.order.optionType ?? null,
    entry.order.strikes?.map(String) ?? null,
    optionalDecimal(entry.order.strikePrice),
    optionalAddress(entry.order.collateralToken),
    optionalAddress(entry.order.underlyingToken),
    optionalDecimal(entry.order.deadline),
    entry.signature.toLowerCase(),
    entry.availableAmount.toString(),
    addressOrEmpty(entry.makerAddress),
    addressOrEmpty(raw.collateral),
    addressOrEmpty(raw.priceFeed),
    addressOrEmpty(raw.implementation),
    raw.strikes,
    raw.isCall,
    raw.isLong,
    raw.orderExpiryTimestamp,
    (raw.extraOptionData || "0x").toLowerCase(),
    raw.maxCollateralUsable,
    optionalAddress(raw.optionBookAddress),
  ];
  return keccak256(toUtf8Bytes(JSON.stringify(canonical))).toLowerCase();
}

export function buildProtectionSignatureHash(signature: string): string {
  if (!isHexString(signature)) throw new Error("Malformed order signature.");
  return keccak256(signature).toLowerCase();
}

export function buildProtectionPurchasePlanId(input: ProtectionPurchasePlanContent): string {
  const plan = ProtectionPurchasePlanContentSchema.parse(input);
  return hashProtectionPurchasePlanContent(plan);
}

function hashProtectionPurchasePlanContent(
  plan: z.infer<typeof ProtectionPurchasePlanContentShapeSchema>,
): string {
  const canonical = [
    plan.version,
    plan.issuedAt,
    plan.validUntil,
    plan.chainId,
    plan.account,
    plan.asset,
    plan.orderFingerprint,
    plan.signatureHash,
    plan.optionBook,
    plan.collateralToken,
    plan.maker,
    plan.nonce,
    plan.signedOrderExpirySeconds,
    plan.expirySeconds,
    plan.strikes8d,
    plan.pricePerContract8d,
    plan.premiumCapMicro,
    plan.estimatedPremiumMicro,
    plan.allowanceAmountMicro,
    plan.numContractsMicro,
    plan.referrer,
    plan.fillDataHash,
  ];
  return keccak256(toUtf8Bytes(JSON.stringify(canonical))).toLowerCase();
}
