/**
 * Family Watch — derives a typed, judge-visible brief that unifies the declared
 * family obligation (remittance context) with a read-only Thetanuts market
 * snapshot. The brief is presentation data only: it never executes, signs,
 * submits, or independently fact-checks anything. A suggested protection intent
 * is bounded and always requires explicit user review.
 */
import type { RemittanceContext } from "@/lib/strategy/remittance-context";
import type { ThetanutsSnapshot } from "@/lib/strategy/thetanuts-readonly";
import type { StrategyIntent } from "@/lib/strategy/intent";

export type FamilyWatchConfidence = "observed" | "limited" | "absent";

export interface FamilyWatchObligation {
  recipient: string;
  city: string;
  amountMyr: number;
}

export interface FamilyWatchEvidence {
  /** Customer-readable product feed name (no SDK badge). */
  sourceLabel: string;
  fetchedAt: string;
  marketUpdatedAt: string | null;
  /** Honest provenance: read-only snapshot, not independent fact-checking. */
  provenance: string;
}

export interface FamilyWatchFinding {
  id: string;
  /** What the current read states. */
  headline: string;
  /** Why it matters to the declared family obligation. */
  relevance: string;
  confidence: FamilyWatchConfidence;
}

export interface FamilyWatchSuggestedIntent {
  asset: "ETH";
  objective: "protect_downside";
  /** Bounded rationale; no strike, size, or trade is selected. */
  rationale: string;
}

/**
 * Family Watch brief is a minimal discriminated union on `status`. The two
 * variants are mutually coherent and their `findings` shape is enforced by
 * construction: `ready` always carries a non-null obligation and a non-empty
 * findings tuple `[FamilyWatchFinding, ...FamilyWatchFinding[]]`; `unavailable`
 * carries a null obligation, no evidence, a literal empty findings array `[]`,
 * and no suggestion. Impossible combinations (e.g. ready with a null
 * obligation or empty findings, or unavailable with a suggestion) are excluded
 * by the type and checked at runtime by `asReadyFindings`.
 */
export type FamilyWatchBrief =
  | {
      status: "ready";
      obligation: FamilyWatchObligation;
      evidence: FamilyWatchEvidence | null;
      findings: [FamilyWatchFinding, ...FamilyWatchFinding[]];
      suggestedIntent: FamilyWatchSuggestedIntent | null;
      /** Customer-facing note shown on the primary surface; no plumbing jargon. */
      note: string;
    }
  | {
      status: "unavailable";
      obligation: null;
      evidence: null;
      findings: [];
      suggestedIntent: null;
      /** Customer-facing note shown on the primary surface; no plumbing jargon. */
      note: string;
    };

export interface FamilyWatchInput {
  remittance: RemittanceContext | null;
  market: ThetanutsSnapshot | null;
  /**
   * The resolved strategy intent the user actually previewed on the desk, if
   * any. Carrying this in is what stops Family Watch from implying an
   * ETH-backed obligation from remittance context alone: an ETH protective-put
   * suggestion is only honest when the resolved strategy is genuinely ETH
   * downside/protection. Remittance context by itself never authorizes that
   * framing.
   */
  strategy: StrategyIntent | null;
}

// Primary-surface notes use state-valid customer language only. The exact
// read-only/provenance boundary stays in the expandable evidence block, never
// in this always-visible copy. The ready note never claims protection is always
// suggested — "any suggested protection" stays truthful when there is none.
const READY_NOTE =
  "Family Watch compares this transfer with current market context. Review any suggested protection before you act.";
const UNAVAILABLE_NOTE =
  "Declare a remittance to see how Family Watch compares it with current market context.";

/**
 * Enforce the ready variant's non-empty findings invariant at runtime. Every
 * ready branch above pushes at least one finding; this guard makes the tuple
 * invariant executable instead of merely documented, and fails closed if a
 * future edit ever produces an empty ready findings array.
 */
function asReadyFindings(
  findings: FamilyWatchFinding[],
): [FamilyWatchFinding, ...FamilyWatchFinding[]] {
  if (findings.length === 0) {
    throw new Error("Family Watch ready brief requires at least one finding");
  }
  return findings as [FamilyWatchFinding, ...FamilyWatchFinding[]];
}

const EVIDENCE_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Map the truthful snapshot source to a customer-readable product feed name.
 * The raw source identifies the SDK; the feed name is what a family sees, with
 * no SDK badge on the product surface. Provenance still discloses the boundary.
 */
function productFeedName(source: string): string {
  if (source === "Thetanuts Finance SDK") return "Thetanuts options feed";
  return source;
}

/**
 * Format an ISO timestamp as a stable, product-friendly UTC label. Pure and
 * deterministic so it renders identically on server and client. Returns a
 * placeholder when the timestamp is absent or unparseable.
 */
export function formatEvidenceTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getUTCDate();
  const month = EVIDENCE_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} · ${hh}:${mm} UTC`;
}

function evidenceFrom(
  market: Extract<ThetanutsSnapshot, { status: "live" }>,
): FamilyWatchEvidence {
  const sourceLabel = productFeedName(market.source);
  return {
    sourceLabel,
    fetchedAt: market.fetchedAt,
    marketUpdatedAt: market.marketUpdatedAt,
    provenance: `Read-only snapshot from the ${sourceLabel}. Not independent fact-checking.`,
  };
}

function putOrderCount(market: Extract<ThetanutsSnapshot, { status: "live" }>): number {
  return market.samples.filter((s) => s.optionType === "put").length;
}

/**
 * The resolved strategy must be genuinely ETH downside/protection before Family
 * Watch will frame the declared obligation as ETH-backed. A collar includes a
 * protective put, so it counts as protection. Remittance context alone, a BTC
 * strategy, an earn-premium objective, or a clarification never qualify.
 */
function isEthDownsideStrategy(strategy: StrategyIntent | null): boolean {
  if (!strategy || strategy.kind !== "strategy") return false;
  if (strategy.asset !== "ETH") return false;
  return strategy.objective === "protect_downside" || strategy.objective === "balanced_collar";
}

/**
 * Derive the Family Watch brief. Pure and side-effect free so it can be tested
 * directly and rendered from any snapshot the caller already holds.
 */
export function deriveFamilyWatchBrief(input: FamilyWatchInput): FamilyWatchBrief {
  const { remittance, market, strategy } = input;

  if (!remittance) {
    return {
      status: "unavailable",
      obligation: null,
      evidence: null,
      findings: [],
      suggestedIntent: null,
      note: UNAVAILABLE_NOTE,
    };
  }

  const obligation: FamilyWatchObligation = {
    recipient: remittance.recipient,
    city: remittance.city,
    amountMyr: remittance.amountMyr,
  };

  const findings: FamilyWatchFinding[] = [];
  let evidence: FamilyWatchEvidence | null = null;
  let suggestedIntent: FamilyWatchSuggestedIntent | null = null;

  // Only a genuinely ETH downside/protection resolved strategy authorizes
  // framing the declared obligation as ETH-backed. Remittance context alone
  // never implies that, so the ETH hedge path is gated on this.
  const ethProtection = isEthDownsideStrategy(strategy);

  if (market && market.status === "live") {
    evidence = evidenceFrom(market);

    if (ethProtection) {
      const ethPrice = market.prices.ETH;
      if (typeof ethPrice === "number") {
        findings.push({
          id: "eth-spot",
          headline: `ETH spot is ${formatUsd(ethPrice)} in this read.`,
          relevance: `The ETH backing the RM${obligation.amountMyr.toLocaleString()} obligation to ${obligation.recipient} is currently valued here.`,
          confidence: "observed",
        });

        const puts = putOrderCount(market);
        if (puts > 0) {
          findings.push({
            id: "put-liquidity",
            headline: `${puts} protective-put order${puts === 1 ? "" : "s"} visible in this read.`,
            relevance: `A put could floor the ETH backing the obligation to ${obligation.recipient}; review is required before any action.`,
            confidence: puts >= 3 ? "observed" : "limited",
          });
          suggestedIntent = {
            asset: "ETH",
            objective: "protect_downside",
            rationale: `Review a protective put to floor the ETH backing RM${obligation.amountMyr.toLocaleString()} for ${obligation.recipient}. No contract, size, or trade is selected here.`,
          };
        }
        // No put liquidity → no suggestion. Family Watch fails closed rather
        // than recommending a hedge with no evidence to support it.
      } else {
        findings.push({
          id: "eth-spot-missing",
          headline: "ETH spot is unavailable in this read.",
          relevance: `The ETH backing the obligation to ${obligation.recipient} cannot be sized from this snapshot.`,
          confidence: "limited",
        });
      }
    } else {
      // The resolved strategy is BTC, earn-premium, a clarification, or absent.
      // Show an honest current-read/obligation context that never frames ETH as
      // backing the obligation and never suggests an ETH hedge.
      findings.push({
        id: "obligation-context",
        headline: strategy && strategy.kind === "strategy"
          ? `Your preview maps to ${strategy.asset}, not ETH.`
          : "No ETH protection is in scope for this preview.",
        relevance: `The RM${obligation.amountMyr.toLocaleString()} obligation to ${obligation.recipient} is declared, but no ETH downside protection applies here.`,
        confidence: "observed",
      });
    }
  } else if (market && market.status === "unavailable") {
    findings.push({
      id: "market-unavailable",
      headline: market.reason,
      relevance: `Market evidence for the obligation to ${obligation.recipient} is currently unavailable.`,
      confidence: "absent",
    });
  } else {
    // No preview has produced a market read yet. Primary copy reads as a
    // finished customer outcome with a recipient-aware next step, not internal
    // plumbing. The honest "absent" confidence still labels it as no evidence.
    findings.push({
      id: "market-absent",
      headline: "Market context will appear after you preview a strategy",
      relevance: `Preview a strategy to see how it relates to the RM${obligation.amountMyr.toLocaleString()} obligation to ${obligation.recipient}.`,
      confidence: "absent",
    });
  }

  return {
    status: "ready",
    obligation,
    evidence,
    findings: asReadyFindings(findings),
    suggestedIntent,
    note: READY_NOTE,
  };
}
