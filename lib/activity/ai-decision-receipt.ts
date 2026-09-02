import { z } from "zod";

const RequestIdSchema = z.string().regex(/^req[-_][A-Za-z0-9_-]{8,91}$/);
const ModelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._/-]+$/);

export const AiDecisionReceiptRecordSchema = z.strictObject({
  requestId: RequestIdSchema,
  model: ModelSchema,
  timestamp: z.iso.datetime({ offset: true }),
  status: z.enum(["unverified", "verified", "mismatch", "unavailable", "not_found"]),
});

export type AiDecisionReceiptRecord = z.infer<typeof AiDecisionReceiptRecordSchema>;

export const AiDecisionReceiptVerifyRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  expectedModel: ModelSchema,
});

const VerifiedPublicReceiptSchema = z.strictObject({
  requestId: RequestIdSchema,
  model: ModelSchema,
  nodeId: z.string().min(1).max(96),
  timestamp: z.iso.datetime({ offset: true }),
  outcome: z.string().min(1).max(32),
  statusCode: z.number().int().min(100).max(599),
  stream: z.boolean(),
  totalTokens: z.number().int().nonnegative(),
  ttftMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const AiDecisionReceiptVerificationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("verified"),
    receipt: VerifiedPublicReceiptSchema,
  }),
  z.strictObject({
    kind: z.literal("mismatch"),
    fields: z.array(z.enum(["request_id", "model"])).min(1).max(2),
  }),
  z.strictObject({ kind: z.literal("unavailable") }),
  z.strictObject({ kind: z.literal("not_found") }),
]);

export type AiDecisionReceiptVerification = z.infer<
  typeof AiDecisionReceiptVerificationSchema
>;

export const AI_DECISION_RECEIPT_STORE_VERSION = 1 as const;
export const AI_DECISION_RECEIPT_STORE_KEY = "convey.ai-decision-receipts.v1" as const;
export const AI_DECISION_RECEIPT_MAX_ITEMS = 20 as const;
export const AI_DECISION_RECEIPT_VERIFY_MAX_BYTES = 1_024 as const;

const StoreSchema = z.strictObject({
  version: z.literal(AI_DECISION_RECEIPT_STORE_VERSION),
  items: z.array(AiDecisionReceiptRecordSchema).max(AI_DECISION_RECEIPT_MAX_ITEMS),
});

export interface AiDecisionReceiptStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): AiDecisionReceiptStorageBackend | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    };
  } catch {
    return null;
  }
}

function newestFirst(
  items: readonly AiDecisionReceiptRecord[],
): AiDecisionReceiptRecord[] {
  return [...items].sort((first, second) => {
    const timestampDelta = Date.parse(second.timestamp) - Date.parse(first.timestamp);
    if (timestampDelta !== 0) return timestampDelta;
    return first.requestId.localeCompare(second.requestId);
  });
}

export function loadAiDecisionReceipts(
  backend: AiDecisionReceiptStorageBackend | null = browserStorage(),
): AiDecisionReceiptRecord[] {
  if (backend === null) return [];
  try {
    const raw = backend.getItem(AI_DECISION_RECEIPT_STORE_KEY);
    if (raw === null) return [];
    const parsed = StoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? newestFirst(parsed.data.items) : [];
  } catch {
    return [];
  }
}

export function recordAiDecisionReceipt(
  candidate: unknown,
  backend: AiDecisionReceiptStorageBackend | null = browserStorage(),
): AiDecisionReceiptRecord | null {
  if (backend === null) return null;
  const parsed = AiDecisionReceiptRecordSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const existing = loadAiDecisionReceipts(backend).filter(
    (item) => item.requestId !== parsed.data.requestId,
  );
  const items = newestFirst([...existing, parsed.data]).slice(
    0,
    AI_DECISION_RECEIPT_MAX_ITEMS,
  );
  try {
    backend.setItem(
      AI_DECISION_RECEIPT_STORE_KEY,
      JSON.stringify({ version: AI_DECISION_RECEIPT_STORE_VERSION, items }),
    );
    return parsed.data;
  } catch {
    return null;
  }
}
