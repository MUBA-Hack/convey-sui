import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_STRATEGY_GOAL_LENGTH, parseStrategyGoal } from "@/lib/strategy/intent";
import { fetchThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";

const RequestSchema = z.object({ goal: z.string().max(MAX_STRATEGY_GOAL_LENGTH * 2) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "validation_error", message: "Invalid JSON payload" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", message: "Body must be { goal: string }" }, { status: 400 });
  }

  const intent = parseStrategyGoal(parsed.data.goal);
  const market = intent.kind === "strategy" ? await fetchThetanutsSnapshot() : null;
  return NextResponse.json({
    intent,
    market,
    execution: "none",
    disclosure: "Educational read-only mapping. Not financial advice. No quote, approval, signature, or trade was submitted.",
  });
}
