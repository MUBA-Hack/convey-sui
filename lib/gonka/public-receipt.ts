import { z } from "zod";

const GonkaRequestIdSchema = z.string().regex(/^req-[A-Za-z0-9-]{8,91}$/);

export const PublicGonkaReceiptSchema = z.strictObject({
  x_request_id: GonkaRequestIdSchema,
  x_devshard_id: z.string().min(1).max(96),
  model: z.string().min(1).max(128),
  created_at: z.iso.datetime({ offset: true }),
  outcome: z.string().min(1).max(32),
  status_code: z.number().int().min(100).max(599),
  stream: z.boolean(),
  total_tokens: z.number().int().nonnegative(),
  ttft_ms: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
});

export type PublicGonkaReceipt = z.infer<typeof PublicGonkaReceiptSchema>;

export async function fetchPublicGonkaReceipt(
  requestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicGonkaReceipt> {
  const safeId = GonkaRequestIdSchema.parse(requestId);
  const response = await fetchImpl(`https://api.gonkarouter.io/v1/receipts/${safeId}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Gonka receipt lookup failed with ${response.status}.`);
  const receipt = PublicGonkaReceiptSchema.parse(await response.json());
  if (receipt.x_request_id !== safeId) throw new Error("Gonka receipt request id mismatch.");
  return receipt;
}
