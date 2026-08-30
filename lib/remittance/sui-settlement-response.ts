import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";
import { USDC_COIN_TYPE_TESTNET } from "./constants";

export const SuiSettlementRejectedReasonSchema = z.enum([
  "invalid_receipt",
  "failed",
  "digest",
  "balance_changes",
  "coin_type",
  "recipient",
  "amount",
  "malformed",
]);

export const SuiSettlementVerificationResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("verified"),
    network: z.literal("testnet"),
    digest: z.string().refine(isValidTransactionDigest),
    coinType: z.literal(USDC_COIN_TYPE_TESTNET),
    recipientAddress: z
      .string()
      .refine(
        (address) =>
          isValidSuiAddress(address) && normalizeSuiAddress(address) === address,
      ),
    receivedMicro: z.string().regex(/^\d+$/),
    checkedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    reason: SuiSettlementRejectedReasonSchema,
  }),
  z.strictObject({
    kind: z.literal("not_found"),
    reason: z.literal("transaction_not_found"),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.literal("rpc_unavailable"),
  }),
]);

export type SuiSettlementRejectedReason = z.infer<
  typeof SuiSettlementRejectedReasonSchema
>;
export type SuiSettlementVerificationResponse = z.infer<
  typeof SuiSettlementVerificationResponseSchema
>;
