import { z } from "zod";

export const QrTaskKindSchema = z.enum(["receive", "request", "split", "allowance", "pass"]);

const TASK_AMOUNT = /^(?:0|[1-9]\d{0,6})\.(?:\d{2}|\d{2,5}[1-9])$/;
const TaskAmountSchema = z.string()
  .regex(TASK_AMOUNT)
  .refine((value) => value !== "0.00", "Amount must be greater than zero");

export const QrTaskEnvelopeSchema = z.strictObject({
  kind: z.literal("convey.qr-task"),
  version: z.literal(1),
  task: QrTaskKindSchema,
  createdAt: z.iso.datetime(),
  reviewRequired: z.literal(true),
  recipient: z.string().trim().min(1).max(80).optional(),
  beneficiary: z.string().trim().min(1).max(80).optional(),
  address: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  amount: TaskAmountSchema.optional(),
  limit: TaskAmountSchema.optional(),
  asset: z.enum(["USDC", "SUI"]),
  note: z.string().trim().max(160).optional(),
  category: z.string().trim().max(60).optional(),
  condition: z.string().trim().max(160).optional(),
  expiresAt: z.iso.datetime().optional(),
  status: z.literal("issued").optional(),
}).superRefine((value, context) => {
  if (!value.amount && !value.limit) {
    context.addIssue({ code: "custom", message: "Amount or limit is required" });
  }
  if (value.task === "allowance" && (!value.beneficiary || !value.limit || !value.category)) {
    context.addIssue({ code: "custom", message: "Allowance details are incomplete" });
  }
  if (value.task !== "receive" && value.task !== "allowance" && !value.recipient) {
    context.addIssue({ code: "custom", message: "Recipient is required" });
  }
});

export type QrTaskEnvelope = z.infer<typeof QrTaskEnvelopeSchema>;

export function parseQrTaskEnvelope(raw: string): QrTaskEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = QrTaskEnvelopeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
