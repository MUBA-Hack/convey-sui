import { z } from "zod";
import { ProtectedTransferExecutionPlanSchema } from "@/lib/remittance/protected-transfer";
import { QuoteEnvelopeSchema } from "@/lib/remittance/quote-schema";

const SuiAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).max(66);
const TransactionKindBytesSchema = z.string().min(1).max(32_768);
const EnokiDigestSchema = z.string().min(1).max(120);
const WalletSignatureSchema = z.string().min(1).max(4_096);

export const SponsoredProtectedTransferRequestSchema = z.strictObject({
  sender: SuiAddressSchema,
  quote: QuoteEnvelopeSchema,
  plan: ProtectedTransferExecutionPlanSchema,
  transactionKindBytes: TransactionKindBytesSchema,
});

export const SponsoredCreateResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("sponsored"),
    bytes: z.string().min(1).max(65_536),
    digest: EnokiDigestSchema,
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.enum(["not_configured", "not_allowed", "provider_error"]),
  }),
]);

export const SponsoredExecuteRequestSchema = z.strictObject({
  digest: EnokiDigestSchema,
  signature: WalletSignatureSchema,
});

export const SponsoredExecuteResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("submitted"),
    digest: z.string().min(1).max(120),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.enum(["not_configured", "invalid_request", "provider_error"]),
  }),
]);

export type SponsoredProtectedTransferRequest = z.infer<
  typeof SponsoredProtectedTransferRequestSchema
>;
export type SponsoredCreateResponse = z.infer<typeof SponsoredCreateResponseSchema>;
export type SponsoredExecuteRequest = z.infer<typeof SponsoredExecuteRequestSchema>;
export type SponsoredExecuteResponse = z.infer<typeof SponsoredExecuteResponseSchema>;
