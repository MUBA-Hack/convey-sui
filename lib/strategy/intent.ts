export const MAX_STRATEGY_GOAL_LENGTH = 500;

export type StrategyAsset = "ETH" | "BTC";
export type StrategyObjective = "protect_downside" | "earn_premium" | "balanced_collar";

export interface StrategyResult {
  kind: "strategy";
  asset: StrategyAsset;
  objective: StrategyObjective;
  horizonDays: number | null;
  strategy: {
    name: "Protective put" | "Covered call" | "Protective collar";
    action: "buy_put" | "sell_call" | "collar";
    thesis: string;
    tradeoff: string;
  };
  educationOnly: true;
}

export interface StrategyClarification {
  kind: "clarification";
  missing: "asset" | "objective" | "safe_goal";
  message: string;
}

export type StrategyIntent = StrategyResult | StrategyClarification;

const UNSAFE_RE =
  /ignore\s+(?:previous|prior|all)|(?:^|\s)(?:system|assistant|user)\s*:|<\s*(?:script|iframe|img)|javascript:|\bact\s+as\b/i;

export function parseStrategyGoal(raw: string): StrategyIntent {
  if (
    typeof raw !== "string" ||
    raw.trim().length === 0 ||
    raw.length > MAX_STRATEGY_GOAL_LENGTH ||
    UNSAFE_RE.test(raw.normalize("NFKC"))
  ) {
    return {
      kind: "clarification",
      missing: "safe_goal",
      message: "Describe a plain-language ETH or BTC risk goal in 500 characters or fewer.",
    };
  }

  const text = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const asset: StrategyAsset | null = /\beth\b|ethereum/.test(text)
    ? "ETH"
    : /\bbtc\b|bitcoin/.test(text)
      ? "BTC"
      : null;

  if (!asset) {
    return {
      kind: "clarification",
      missing: "asset",
      message: "Which asset should the educational mapping use: ETH or BTC?",
    };
  }

  const protection = /protect|downside|hedge|floor|loss|risk/.test(text);
  const income = /earn|income|premium|yield|offset|cashflow/.test(text);
  if (!protection && !income) {
    return {
      kind: "clarification",
      missing: "objective",
      message: "Should the mapping prioritize downside protection or premium income?",
    };
  }

  const horizon = text.match(/\b(\d{1,3})\s*(?:day|days|d)\b/);
  const horizonDays = horizon ? Math.min(Number(horizon[1]), 365) : null;

  if (protection && income) {
    return {
      kind: "strategy",
      asset,
      objective: "balanced_collar",
      horizonDays,
      strategy: {
        name: "Protective collar",
        action: "collar",
        thesis: "Pair a protective put with a covered call to define a downside floor while offsetting premium cost.",
        tradeoff: "The call can cap upside, and the hedge still depends on available strikes, expiry, and liquidity.",
      },
      educationOnly: true,
    };
  }

  if (protection) {
    return {
      kind: "strategy",
      asset,
      objective: "protect_downside",
      horizonDays,
      strategy: {
        name: "Protective put",
        action: "buy_put",
        thesis: "A put can define a downside floor for an asset you already hold.",
        tradeoff: "Protection costs premium and expires; this mapping does not select or submit a contract.",
      },
      educationOnly: true,
    };
  }

  return {
    kind: "strategy",
    asset,
    objective: "earn_premium",
    horizonDays,
    strategy: {
      name: "Covered call",
      action: "sell_call",
      thesis: "A call written against an existing holding can exchange some upside for premium income.",
      tradeoff: "Upside can be capped and losses on the underlying remain; no position is opened here.",
    },
    educationOnly: true,
  };
}
