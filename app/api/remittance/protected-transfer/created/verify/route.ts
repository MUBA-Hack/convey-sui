import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import {
  PROTECTED_TRANSFER_CREATED_VERIFY_MAX_BYTES,
  ProtectedTransferCreatedVerifyRequestSchema,
  ProtectedTransferCreatedVerifyResponseSchema,
  type ProtectedTransferCreatedVerifyResponse,
} from "@/lib/remittance/protected-transfer-created";
import { verifyProtectedTransferCreatedOnSui } from "@/lib/remittance/protected-transfer-created.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: ProtectedTransferCreatedVerifyResponse) {
  return NextResponse.json(ProtectedTransferCreatedVerifyResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(req: Request) {
  const raw = await readBoundedUtf8Body(req, PROTECTED_TRANSFER_CREATED_VERIFY_MAX_BYTES);
  if (raw === null) return response({ kind: "rejected", reason: "invalid_request" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ kind: "rejected", reason: "invalid_request" });
  }
  const parsed = ProtectedTransferCreatedVerifyRequestSchema.safeParse(body);
  if (!parsed.success) return response({ kind: "rejected", reason: "invalid_request" });
  return response(await verifyProtectedTransferCreatedOnSui(parsed.data));
}
