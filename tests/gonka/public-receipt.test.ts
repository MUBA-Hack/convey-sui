import { describe, expect, it, vi } from "vitest";
import { fetchPublicGonkaReceipt } from "@/lib/gonka/public-receipt";

const receipt = {
  x_request_id: "req-1788163015848361746-40652",
  x_devshard_id: "67670",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731",
  created_at: "2026-08-31T07:57:46Z",
  outcome: "success",
  status_code: 200,
  stream: true,
  total_tokens: 34064,
  ttft_ms: 15650,
  duration_ms: 50920,
};

describe("fetchPublicGonkaReceipt", () => {
  it("returns strict public provenance metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt), { status: 200 }));
    await expect(fetchPublicGonkaReceipt(receipt.x_request_id, fetchImpl)).resolves.toEqual(receipt);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.gonkarouter.io/v1/receipts/${receipt.x_request_id}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects malformed identifiers and extra response fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt, prompt: "secret" }), { status: 200 }));
    await expect(fetchPublicGonkaReceipt("../chat/completions", fetchImpl)).rejects.toThrow();
    await expect(fetchPublicGonkaReceipt(receipt.x_request_id, fetchImpl)).rejects.toThrow();
  });
});
