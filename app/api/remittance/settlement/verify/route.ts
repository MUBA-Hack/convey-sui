import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
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

export async function POST(req: Request) {
  // Shared transport reader owns Content-Length grammar, byte cap, declared/
  // actual equality, read/cancel rejection, and fatal UTF-8. A null transport
  // result fails closed as invalid_receipt.
  const raw = await readBoundedUtf8Body(req, REMITTANCE_RECEIPT_MAX_BYTES);
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
