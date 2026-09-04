import { QrTaskEnvelopeSchema } from "@/lib/commerce/qr-task";

const USDC_SCALE = 1_000_000n;

export interface ReceiptSplitShareInput {
  origin: string;
  participant: string;
  amountMicro: string;
  asset: "SUI" | "USDC";
  note: string;
  createdAt: number;
  expiresAt: number;
}

export interface ReceiptSplitShare {
  payload: string;
  reviewUrl: string;
  whatsappUrl: string;
}

function formatExactTaskAmount(amountMicro: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(amountMicro)) {
    throw new Error("Split amount must use canonical micro units.");
  }
  const amount = BigInt(amountMicro);
  if (amount <= 0n) throw new RangeError("Split amount must be greater than zero.");
  const whole = amount / USDC_SCALE;
  const fraction = (amount % USDC_SCALE).toString().padStart(6, "0");
  const significant = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${significant}`;
}

export function createReceiptSplitShare(input: ReceiptSplitShareInput): ReceiptSplitShare {
  if (!Number.isSafeInteger(input.createdAt) || !Number.isSafeInteger(input.expiresAt)) {
    throw new Error("Split request dates must be integer milliseconds.");
  }
  if (input.expiresAt <= input.createdAt) {
    throw new RangeError("Split request expiry must be after creation.");
  }
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    throw new Error("Split request origin must use HTTP or HTTPS.");
  }
  const envelope = QrTaskEnvelopeSchema.parse({
    kind: "convey.qr-task",
    version: 1,
    task: "split",
    createdAt: new Date(input.createdAt).toISOString(),
    reviewRequired: true,
    recipient: input.participant,
    amount: formatExactTaskAmount(input.amountMicro),
    asset: input.asset,
    note: input.note,
    expiresAt: new Date(input.expiresAt).toISOString(),
  });
  const payload = JSON.stringify(envelope);
  const review = new URL("/qr-ferry", origin.origin);
  review.searchParams.set("code", payload);
  const reviewUrl = review.toString();
  const message = `${envelope.recipient}, your ${envelope.note || "receipt"} share is ${envelope.amount} ${envelope.asset}. Open this request, review it, then approve in your wallet: ${reviewUrl}`;
  return {
    payload,
    reviewUrl,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
  };
}
