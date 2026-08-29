import { NextResponse } from "next/server";
import { z } from "zod";
import { parseIntent, MAX_INPUT_LENGTH } from "@/lib/commerce/intent";

/**
 * POST /api/commerce/intent
 *
 * Accepts a free-text purchase command and returns a strictly typed preview
 * or a specific clarification. Never returns transaction bytes, signatures,
 * or any executable payload derived from raw text — the caller must build and
 * sign any transaction only after an explicit confirm gate on the preview.
 */

const RequestSchema = z.object({
  text: z.string().max(MAX_INPUT_LENGTH * 4),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Body must be { text: string }" },
      { status: 400 },
    );
  }

  const result = parseIntent(parsed.data.text);
  return NextResponse.json(result, { status: 200 });
}
