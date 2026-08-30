import { NextResponse } from "next/server";
import {
  REMITTANCE_RECEIPT_MAX_BYTES,
  RemittanceReceiptSchema,
} from "@/lib/remittance/receipt-proof";
import {
  SuiSettlementVerificationResponseSchema,
  verifyReceiptSettlementOnSui,
  type SuiSettlementVerificationResponse,
} from "@/lib/remittance/sui-settlement.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: SuiSettlementVerificationResponse) {
  return NextResponse.json(SuiSettlementVerificationResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

async function readBoundedBody(req: Request): Promise<string | null> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > REMITTANCE_RECEIPT_MAX_BYTES) {
      return null;
    }
  }
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REMITTANCE_RECEIPT_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const raw = await readBoundedBody(req);
  if (raw === null) {
    return response({ kind: "rejected", reason: "invalid_receipt" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ kind: "rejected", reason: "invalid_receipt" });
  }

  const receipt = RemittanceReceiptSchema.safeParse(body);
  if (!receipt.success) {
    return response({ kind: "rejected", reason: "invalid_receipt" });
  }

  return response(await verifyReceiptSettlementOnSui(receipt.data));
}
