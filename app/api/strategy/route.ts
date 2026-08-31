import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBoundedJsonRequest } from "@/lib/http/parse-bounded-json-request.server";
import { PROTECTION_PURCHASE_MAX_BODY_BYTES } from "@/lib/strategy/protection-purchase";
import { MAX_STRATEGY_GOAL_LENGTH, parseStrategyGoal } from "@/lib/strategy/intent";
import { fetchThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import { fetchShieldRecommendation } from "@/lib/strategy/thetanuts-shield";
import { parseShieldRecommendation, PremiumBudgetUsdSchema } from "@/lib/strategy/shield-recommendation";
import { acquireStrategyBaseGate, releaseStrategyBaseGate } from "@/lib/strategy/strategy-base-gate.server";

const RequestSchema = z
  .object({
    goal: z.string().max(MAX_STRATEGY_GOAL_LENGTH * 2),
    // Optional TOTAL premium budget (USD). Gates the actionable Shield branch.
    // Validated at the HTTP boundary via the shared schema so >2 fractional
    // decimals is a 400 error, not a downstream unavailable.
    premiumBudgetUsd: PremiumBudgetUsdSchema.optional(),
  })
  .strict();

const SHIELD_DISCLOSURE =
  "Actionable protective-put preflight. Not financial advice and not a guaranteed floor. Approval in a connected wallet is required before any fill; no transaction is submitted here.";

export async function POST(request: Request) {
  const body = await parseBoundedJsonRequest(
    request,
    PROTECTION_PURCHASE_MAX_BODY_BYTES,
  );
  if (!body.ok) {
    return NextResponse.json({ error: "validation_error", message: "Invalid JSON payload" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Body must be { goal: string, premiumBudgetUsd?: number }" },
      { status: 400 },
    );
  }

  const intent = parseStrategyGoal(parsed.data.goal);

  // Shield branch: only for a parsed protective-put intent with a non-null
  // horizon (parseStrategyGoal guarantees 1..365 for non-null) and a budget.
  // Missing horizon, earn-premium, collar, or clarification falls back to the
  // educational read-only mapping and never touches the SDK.
  if (
    intent.kind === "strategy" &&
    intent.objective === "protect_downside" &&
    intent.horizonDays !== null &&
    parsed.data.premiumBudgetUsd !== undefined
  ) {
    const fetchedAt = new Date().toISOString();
    let recommendation;
    if (acquireStrategyBaseGate() !== "accepted") {
      recommendation = { kind: "unavailable" as const, fetchedAt, reason: "Live market data is currently unavailable." };
    } else {
      try {
        recommendation = await fetchShieldRecommendation(
          {
            asset: intent.asset,
            horizonDays: intent.horizonDays,
            premiumBudgetUsd: parsed.data.premiumBudgetUsd,
          },
          { now: Math.floor(Date.now() / 1000) },
        );
      } catch {
        recommendation = { kind: "unavailable" as const, fetchedAt, reason: "Live market data is currently unavailable." };
      } finally {
        releaseStrategyBaseGate();
      }
    }
    // Final fail-closed parse through the strict public union before response.
    const verified = parseShieldRecommendation(recommendation) ?? {
      kind: "unavailable" as const,
      fetchedAt: new Date().toISOString(),
      reason: "Live market data is currently unavailable.",
    };
    return NextResponse.json(
      { intent, recommendation: verified, execution: "none", disclosure: SHIELD_DISCLOSURE },
      { status: 200 },
    );
  }

  // Backwards-compatible educational read-only mapping (no budget, no horizon,
  // or non-protect intent). Preserves the original { intent, market, execution,
  // disclosure } response shape exactly.
  let market = null;
  if (intent.kind === "strategy" && acquireStrategyBaseGate() === "accepted") {
    try {
      market = await fetchThetanutsSnapshot();
    } catch {
      market = null;
    } finally {
      releaseStrategyBaseGate();
    }
  }
  return NextResponse.json({
    intent,
    market,
    execution: "none",
    disclosure: "Educational read-only mapping. Not financial advice. No quote, approval, signature, or trade was submitted.",
  });
}
