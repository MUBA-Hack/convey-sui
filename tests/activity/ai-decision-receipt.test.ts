import { describe, expect, it } from "vitest";
import {
  AI_DECISION_RECEIPT_STORE_KEY,
  AI_DECISION_RECEIPT_STORE_VERSION,
  AiDecisionReceiptRecordSchema,
  loadAiDecisionReceipts,
  recordAiDecisionReceipt,
  type AiDecisionReceiptStorageBackend,
} from "@/lib/activity/ai-decision-receipt";

const record = {
  requestId: "req-1788163015848361746-40652",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731",
  timestamp: "2026-08-31T07:57:46Z",
  status: "unverified" as const,
};

function backend(initial: string | null = null): AiDecisionReceiptStorageBackend & {
  value: string | null;
} {
  return {
    value: initial,
    getItem(key) {
      expect(key).toBe(AI_DECISION_RECEIPT_STORE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(AI_DECISION_RECEIPT_STORE_KEY);
      this.value = value;
    },
  };
}

describe("AiDecisionReceiptRecordSchema", () => {
  it("contains only bounded public provenance metadata", () => {
    expect(AiDecisionReceiptRecordSchema.parse(record)).toEqual(record);
    expect(
      AiDecisionReceiptRecordSchema.safeParse({ ...record, prompt: "send money" }).success,
    ).toBe(false);
    expect(
      AiDecisionReceiptRecordSchema.safeParse({ ...record, response: "approved" }).success,
    ).toBe(false);
    expect(
      AiDecisionReceiptRecordSchema.safeParse({ ...record, requestId: "../chat" }).success,
    ).toBe(false);
    expect(
      AiDecisionReceiptRecordSchema.safeParse({ ...record, model: "x".repeat(129) }).success,
    ).toBe(false);
  });
});

describe("AI decision Activity storage", () => {
  it("persists exactly four record fields in a versioned envelope", () => {
    const storage = backend();
    expect(recordAiDecisionReceipt(record, storage)).toEqual(record);

    const persisted = JSON.parse(storage.value ?? "null");
    expect(persisted).toEqual({
      version: AI_DECISION_RECEIPT_STORE_VERSION,
      items: [record],
    });
    expect(Object.keys(persisted.items[0])).toEqual([
      "requestId",
      "model",
      "timestamp",
      "status",
    ]);
  });

  it("upserts by request id, orders newest first, and caps at 20", () => {
    const storage = backend();
    for (let index = 0; index < 22; index += 1) {
      recordAiDecisionReceipt(
        {
          ...record,
          requestId: `req-${String(index).padStart(8, "0")}`,
          timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
        },
        storage,
      );
    }
    recordAiDecisionReceipt(
      {
        ...record,
        requestId: "req-00000021",
        timestamp: "2026-09-01T00:00:00.000Z",
        status: "verified",
      },
      storage,
    );

    const items = loadAiDecisionReceipts(storage);
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ requestId: "req-00000021", status: "verified" });
    expect(new Set(items.map((item) => item.requestId)).size).toBe(20);
  });

  it("fails safely for malformed storage or blocked browser access", () => {
    expect(loadAiDecisionReceipts(backend("{broken"))).toEqual([]);
    const blocked: AiDecisionReceiptStorageBackend = {
      getItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(loadAiDecisionReceipts(blocked)).toEqual([]);
    expect(recordAiDecisionReceipt(record, blocked)).toBeNull();
  });
});
