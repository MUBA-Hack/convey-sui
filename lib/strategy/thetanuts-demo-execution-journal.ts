import { isAddress } from "ethers";
import { z } from "zod";
import { PROTECTION_PURCHASE_CHAIN_ID } from "@/lib/strategy/protection-purchase";

const IntegerStringSchema = z.string().regex(/^[1-9]\d*$/u);
const OrderFingerprintSchema = z.string().regex(/^0x[0-9a-f]{64}$/u);
const AccountSchema = z
  .string()
  .refine(isAddress, "invalid account")
  .transform((value) => value.toLowerCase());
const TimestampSchema = z.string().datetime({ offset: true });

const BindingSchema = z.strictObject({
  account: AccountSchema,
  chainId: z.number().int().positive(),
  orderFingerprint: OrderFingerprintSchema,
});

export const DemoExecutionCapsSchema = z
  .strictObject({
    premiumMicro: IntegerStringSchema,
    maximumLossMicro: IntegerStringSchema,
    spendMicro: IntegerStringSchema,
  })
  .superRefine((caps, context) => {
    if (BigInt(caps.premiumMicro) > BigInt(caps.spendMicro)) {
      context.addIssue({
        code: "custom",
        path: ["premiumMicro"],
        message: "premium cap exceeds spend cap",
      });
    }
  });

export const DemoExecutionPolicySchema = z
  .strictObject({
    mode: z.literal("demo"),
    reviewedAt: TimestampSchema,
    validUntil: TimestampSchema,
    account: AccountSchema,
    chainId: z.literal(PROTECTION_PURCHASE_CHAIN_ID),
    orderFingerprint: OrderFingerprintSchema,
    caps: DemoExecutionCapsSchema,
    receiptId: z.string().regex(/^demo-receipt:[a-z0-9-]+$/u),
  })
  .superRefine((policy, context) => {
    if (Date.parse(policy.validUntil) <= Date.parse(policy.reviewedAt)) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "policy review window is stale",
      });
    }
  });

const DemoExecutionStatusSchema = z.enum([
  "policy_reviewed",
  "approval_submitted",
  "approval_confirmed",
  "fill_submitted",
  "pending_verification",
  "verified",
  "rejected",
]);

const DemoExecutionEventSchema = z.strictObject({
  status: DemoExecutionStatusSchema,
  at: TimestampSchema,
  attempt: z.number().int().positive(),
});

const DemoExecutionReceiptSchema = z.strictObject({
  mode: z.literal("demo"),
  evidence: z.literal("simulated"),
  receiptId: z.string().regex(/^demo-receipt:[a-z0-9-]+$/u),
  account: AccountSchema,
  chainId: z.literal(PROTECTION_PURCHASE_CHAIN_ID),
  orderFingerprint: OrderFingerprintSchema,
  premiumMicro: IntegerStringSchema,
  maximumLossMicro: IntegerStringSchema,
  spendMicro: IntegerStringSchema,
  verifiedAt: TimestampSchema,
});

export const DemoExecutionJournalSchema = z
  .strictObject({
    version: z.literal(1),
    mode: z.literal("demo"),
    status: DemoExecutionStatusSchema,
    attempt: z.number().int().positive(),
    policy: DemoExecutionPolicySchema,
    events: z.array(DemoExecutionEventSchema).min(1),
    receipt: DemoExecutionReceiptSchema.nullable(),
    rejectionReason: z.string().min(1).max(200).nullable(),
  })
  .superRefine((journal, context) => {
    const lastEvent = journal.events.at(-1);
    if (lastEvent?.status !== journal.status || lastEvent.attempt !== journal.attempt) {
      context.addIssue({ code: "custom", path: ["events"], message: "event history does not match status" });
    }
    if ((journal.status === "verified") !== (journal.receipt !== null)) {
      context.addIssue({ code: "custom", path: ["receipt"], message: "receipt does not match verified status" });
    }
    if ((journal.status === "rejected") !== (journal.rejectionReason !== null)) {
      context.addIssue({ code: "custom", path: ["rejectionReason"], message: "reason does not match rejected status" });
    }
    if (journal.receipt && (
      journal.receipt.account !== journal.policy.account ||
      journal.receipt.chainId !== journal.policy.chainId ||
      journal.receipt.orderFingerprint !== journal.policy.orderFingerprint ||
      journal.receipt.receiptId !== journal.policy.receiptId ||
      BigInt(journal.receipt.premiumMicro) > BigInt(journal.policy.caps.premiumMicro) ||
      BigInt(journal.receipt.maximumLossMicro) > BigInt(journal.policy.caps.maximumLossMicro) ||
      BigInt(journal.receipt.spendMicro) > BigInt(journal.policy.caps.spendMicro)
    )) {
      context.addIssue({ code: "custom", path: ["receipt"], message: "receipt binding or caps do not match policy" });
    }
  });

export type DemoExecutionPolicy = z.infer<typeof DemoExecutionPolicySchema>;
export type DemoExecutionJournal = z.infer<typeof DemoExecutionJournalSchema>;

export const DEMO_THETANUTS_EXECUTION_FIXTURE = Object.freeze({
  mode: "demo" as const,
  reviewedAt: "2026-09-02T12:00:00.000Z",
  validUntil: "2026-09-02T12:05:00.000Z",
  account: "0x0000000000000000000000000000000000000001",
  chainId: PROTECTION_PURCHASE_CHAIN_ID,
  orderFingerprint: `0x${"11".repeat(32)}`,
  caps: Object.freeze({
    premiumMicro: "3000000",
    maximumLossMicro: "500000000",
    spendMicro: "3000000",
  }),
  receiptId: "demo-receipt:eth-protection-001",
});

const SubmitApprovalCommandSchema = z.strictObject({
  type: z.literal("submit_approval"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  amountMicro: IntegerStringSchema,
});

const ConfirmApprovalCommandSchema = z.strictObject({
  type: z.literal("confirm_approval"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  amountMicro: IntegerStringSchema,
});

const SubmitFillCommandSchema = z.strictObject({
  type: z.literal("submit_fill"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  caps: DemoExecutionCapsSchema,
});

const MarkPendingCommandSchema = z.strictObject({
  type: z.literal("mark_pending_verification"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  receiptId: z.string().regex(/^demo-receipt:[a-z0-9-]+$/u),
});

const VerifyCommandSchema = z.strictObject({
  type: z.literal("resolve_verification"),
  outcome: z.literal("verified"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  receiptId: z.string().regex(/^demo-receipt:[a-z0-9-]+$/u),
  observedPremiumMicro: IntegerStringSchema,
  observedMaximumLossMicro: IntegerStringSchema,
  observedSpendMicro: IntegerStringSchema,
});

const RejectCommandSchema = z.strictObject({
  type: z.literal("resolve_verification"),
  outcome: z.literal("rejected"),
  at: TimestampSchema,
  ...BindingSchema.shape,
  receiptId: z.string().regex(/^demo-receipt:[a-z0-9-]+$/u),
  reason: z.string().min(1).max(200),
});

const RetryCommandSchema = z.strictObject({
  type: z.literal("retry"),
  at: TimestampSchema,
  validUntil: TimestampSchema,
  ...BindingSchema.shape,
});

export const DemoExecutionCommandSchema = z.union([
  SubmitApprovalCommandSchema,
  ConfirmApprovalCommandSchema,
  SubmitFillCommandSchema,
  MarkPendingCommandSchema,
  VerifyCommandSchema,
  RejectCommandSchema,
  RetryCommandSchema,
]);

export type DemoExecutionCommand = z.infer<typeof DemoExecutionCommandSchema>;

export function createDemoExecutionJournal(input: unknown): DemoExecutionJournal {
  const policy = DemoExecutionPolicySchema.parse(input);
  return DemoExecutionJournalSchema.parse({
    version: 1,
    mode: "demo",
    status: "policy_reviewed",
    attempt: 1,
    policy,
    events: [{ status: "policy_reviewed", at: policy.reviewedAt, attempt: 1 }],
    receipt: null,
    rejectionReason: null,
  });
}

function assertBinding(journal: DemoExecutionJournal, command: DemoExecutionCommand): void {
  if (
    journal.policy.account !== command.account ||
    journal.policy.chainId !== command.chainId ||
    journal.policy.orderFingerprint !== command.orderFingerprint
  ) {
    throw new Error("Demo execution binding mismatch.");
  }
}

function assertFresh(journal: DemoExecutionJournal, at: string): void {
  if (Date.parse(at) > Date.parse(journal.policy.validUntil)) {
    throw new Error("Demo execution policy is stale.");
  }
}

function assertAfterLastEvent(journal: DemoExecutionJournal, at: string): void {
  const last = journal.events.at(-1);
  if (last && Date.parse(at) < Date.parse(last.at)) {
    throw new Error("Demo execution event timestamp moved backwards.");
  }
}

function withStatus(
  journal: DemoExecutionJournal,
  status: DemoExecutionJournal["status"],
  at: string,
  patch: Partial<Pick<DemoExecutionJournal, "receipt" | "rejectionReason">> = {},
): DemoExecutionJournal {
  return DemoExecutionJournalSchema.parse({
    ...journal,
    ...patch,
    status,
    events: [...journal.events, { status, at, attempt: journal.attempt }],
  });
}

function assertExactCaps(journal: DemoExecutionJournal, caps: DemoExecutionPolicy["caps"]): void {
  if (
    caps.premiumMicro !== journal.policy.caps.premiumMicro ||
    caps.maximumLossMicro !== journal.policy.caps.maximumLossMicro ||
    caps.spendMicro !== journal.policy.caps.spendMicro
  ) {
    throw new Error("Demo execution caps do not exactly match reviewed caps.");
  }
}

export function advanceDemoExecutionJournal(
  journalInput: unknown,
  commandInput: unknown,
): DemoExecutionJournal {
  const journal = DemoExecutionJournalSchema.parse(journalInput);
  const command = DemoExecutionCommandSchema.parse(commandInput);
  assertBinding(journal, command);
  assertAfterLastEvent(journal, command.at);

  if (command.type === "retry") {
    if (journal.status !== "rejected") {
      throw new Error("Only a rejected demo execution can be retried.");
    }
    if (Date.parse(command.validUntil) <= Date.parse(command.at)) {
      throw new Error("Retry requires a fresh policy review window.");
    }
    const attempt = journal.attempt + 1;
    return DemoExecutionJournalSchema.parse({
      ...journal,
      status: "policy_reviewed",
      attempt,
      policy: { ...journal.policy, reviewedAt: command.at, validUntil: command.validUntil },
      events: [...journal.events, { status: "policy_reviewed", at: command.at, attempt }],
      receipt: null,
      rejectionReason: null,
    });
  }

  if (journal.status === "pending_verification" && command.type === "submit_fill") {
    throw new Error("Fill rebroadcast blocked while pending verification.");
  }

  if (command.type === "submit_approval") {
    if (journal.status !== "policy_reviewed") throw new Error("Approval submission is out of sequence.");
    assertFresh(journal, command.at);
    if (command.amountMicro !== journal.policy.caps.spendMicro) {
      throw new Error("Approval must use exact reviewed spend cap.");
    }
    return withStatus(journal, "approval_submitted", command.at);
  }

  if (command.type === "confirm_approval") {
    if (journal.status !== "approval_submitted") throw new Error("Approval confirmation is out of sequence.");
    assertFresh(journal, command.at);
    if (command.amountMicro !== journal.policy.caps.spendMicro) {
      throw new Error("Confirmed approval must match exact reviewed spend cap.");
    }
    return withStatus(journal, "approval_confirmed", command.at);
  }

  if (command.type === "submit_fill") {
    if (journal.status !== "approval_confirmed") throw new Error("Fill submission is out of sequence.");
    assertFresh(journal, command.at);
    assertExactCaps(journal, command.caps);
    return withStatus(journal, "fill_submitted", command.at);
  }

  if (command.type === "mark_pending_verification") {
    if (journal.status !== "fill_submitted") throw new Error("Pending verification is out of sequence.");
    if (command.receiptId !== journal.policy.receiptId) throw new Error("Demo receipt binding mismatch.");
    return withStatus(journal, "pending_verification", command.at);
  }

  if (command.type === "resolve_verification") {
    if (journal.status !== "pending_verification") throw new Error("Verification resolution is out of sequence.");
    if (command.receiptId !== journal.policy.receiptId) throw new Error("Demo receipt binding mismatch.");
    if (command.outcome === "rejected") {
      return withStatus(journal, "rejected", command.at, { rejectionReason: command.reason });
    }

    const observed = {
      premiumMicro: command.observedPremiumMicro,
      maximumLossMicro: command.observedMaximumLossMicro,
      spendMicro: command.observedSpendMicro,
    };
    if (
      BigInt(observed.premiumMicro) > BigInt(journal.policy.caps.premiumMicro) ||
      BigInt(observed.maximumLossMicro) > BigInt(journal.policy.caps.maximumLossMicro) ||
      BigInt(observed.spendMicro) > BigInt(journal.policy.caps.spendMicro)
    ) {
      throw new Error("Simulated verification exceeds reviewed caps.");
    }
    return withStatus(journal, "verified", command.at, {
      rejectionReason: null,
      receipt: {
        mode: "demo",
        evidence: "simulated",
        receiptId: command.receiptId,
        ...bindingFrom(journal),
        premiumMicro: observed.premiumMicro,
        maximumLossMicro: observed.maximumLossMicro,
        spendMicro: observed.spendMicro,
        verifiedAt: command.at,
      },
    });
  }

  throw new Error("Unsupported demo execution command.");
}

function bindingFrom(journal: DemoExecutionJournal) {
  return {
    account: journal.policy.account,
    chainId: journal.policy.chainId,
    orderFingerprint: journal.policy.orderFingerprint,
  };
}
