import { NextResponse } from "next/server";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-utf8-body.server";
import {
  WEB_VERIFICATION_REQUEST_MAX_BYTES,
  WebVerificationRequestSchema,
  WebVerificationResponseSchema,
  type WebVerificationResponse,
} from "@/lib/verification/web-evidence";
import { runWebVerification, type WebVerificationDependencies } from "@/lib/verification/web-verification.server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const TEST_DEPENDENCIES: { current: WebVerificationDependencies | null } = { current: null };

export function __setWebVerificationDependenciesForTest(
  dependencies: WebVerificationDependencies | null,
): void {
  TEST_DEPENDENCIES.current = dependencies;
}

function response(body: WebVerificationResponse) {
  return NextResponse.json(WebVerificationResponseSchema.parse(body), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: Request) {
  const raw = await readBoundedUtf8Body(request, WEB_VERIFICATION_REQUEST_MAX_BYTES);
  if (raw === null) return response({ kind: "web_verification_unavailable", reason: "invalid_input" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ kind: "web_verification_unavailable", reason: "invalid_input" });
  }
  const parsed = WebVerificationRequestSchema.safeParse(body);
  if (!parsed.success) return response({ kind: "web_verification_unavailable", reason: "invalid_input" });
  return response(await runWebVerification(parsed.data.query, TEST_DEPENDENCIES.current ?? {}));
}
