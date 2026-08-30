/**
 * Remittance quote builder — pure integer fee/FX math.
 *
 * Given a validated remittance intent, a mapped recipient address (or null),
 * and a reference-pricing config, produce a deterministic typed quote envelope
 * WITHOUT an attestation. No floating point anywhere: every monetary value is a
 * BigInt minor-unit string. The attestation is computed separately by the
 * server-only quote route using `attestation.server.ts` — this module never
 * imports a secret, an HMAC, or any server-only code, so it stays client-safe.
 *
 * The quote carries every field a customer needs, explicit reference
 * provenance, an expiry, and a non-PII beneficiary reference. It never claims
 * fiat payout completed.
 */

import { MYR_PHP_CORRIDOR } from "./constants";
import { formatUsdc } from "./money";
import type { RemittanceIntentInput, RemittanceClarificationCode } from "./parser";
import type { QuoteEnvelope } from "./quote-schema";

export type { QuoteEnvelope } from "./quote-schema";
export {
  formatMinor,
  formatMinorFixed,
  formatMinorFixedGrouped,
  formatMyr,
  formatMyrFixed,
  formatMyrFixedGrouped,
  formatPhp,
  formatPhpFixedGrouped,
  formatUsdc,
  formatMinorGrouped,
  formatMyrGrouped,
  formatPhpGrouped,
  formatUsdcGrouped,
  groupInteger,
} from "./money";

export interface RemittanceQuoteError {
  kind: "clarification";
  clarification: { code: RemittanceClarificationCode; reason: string };
}

/**
 * Build a deterministic reference quote envelope from a validated intent, a
 * mapped recipient address, and a config. Returns a `RemittanceQuoteError`
 * when the amount is out of bounds or the fee consumes the entire send (so the
 * convertible remainder is non-positive). `now` is injected so tests are
 * deterministic.
 *
 * The `recipientAddress` is passed explicitly by the route (resolved from the
 * server-only mapping); the parser never resolves addresses. The returned
 * envelope has `attestation: null` — the route attaches the server-issued
 * attestation after this returns.
 */
export function buildQuote(
  intent: RemittanceIntentInput,
  recipientAddress: string | null,
  config: {
    myrPerUsdc: bigint;
    phpPerUsdc: bigint;
    fixedFeeMyr: bigint;
    feeBps: number;
    maxSendMyr: bigint;
    minSendMyr: bigint;
    quoteTtlMs: number;
    payoutMethod: string;
    estimatedArrival: string;
  },
  now: number,
): QuoteEnvelope | RemittanceQuoteError {
  const sendAmount = BigInt(intent.amountMinor);

  if (sendAmount <= 0n) {
    return {
      kind: "clarification",
      clarification: { code: "amount_too_small", reason: "Send amount must be greater than zero." },
    };
  }
  if (sendAmount < config.minSendMyr) {
    return {
      kind: "clarification",
      clarification: {
        code: "amount_too_small",
        reason: `Send amount must be at least ${formatMyrMinor(config.minSendMyr)} MYR.`,
      },
    };
  }
  if (sendAmount > config.maxSendMyr) {
    return {
      kind: "clarification",
      clarification: {
        code: "amount_exceeds_max",
        reason: `Send amount exceeds the maximum of ${formatMyrMinor(config.maxSendMyr)} MYR.`,
      },
    };
  }

  // Fee: fixed + basis-points portion on the send amount. Integer only.
  const feeBpsPortion = (sendAmount * BigInt(config.feeBps)) / 10_000n;
  const totalFee = config.fixedFeeMyr + feeBpsPortion;

  // The convertible remainder is what actually becomes USDC. If the fee
  // consumes the entire send, fail closed — never produce a zero/negative
  // transfer.
  const convertible = sendAmount - totalFee;
  if (convertible <= 0n) {
    return {
      kind: "clarification",
      clarification: {
        code: "amount_too_small",
        reason: "Send amount is too small after fees.",
      },
    };
  }

  // FX: MYR sen -> USDC micro (6 decimals) -> PHP centavos. Floor at each
  // step so the on-chain USDC amount and the family-receives amount are exact
  // integers, never rounded up beyond what the customer pays.
  const usdcMicro = (convertible * 1_000_000n) / config.myrPerUsdc;
  if (usdcMicro <= 0n) {
    return {
      kind: "clarification",
      clarification: {
        code: "amount_too_small",
        reason: "Send amount is too small for the configured rate.",
      },
    };
  }
  const familyReceivesPhp = (usdcMicro * config.phpPerUsdc) / 1_000_000n;
  if (familyReceivesPhp <= 0n) {
    return {
      kind: "clarification",
      clarification: {
        code: "amount_too_small",
        reason: "Send amount is too small for the configured rate.",
      },
    };
  }

  // Exchange rate text: 1 MYR = (phpPerUsdc / myrPerUsdc) PHP. Emit enough
  // deterministic decimal precision that multiplying the displayed converted
  // MYR amount by the displayed rate rounds to the displayed PHP centavos.
  // For the pinned corridor (5600/450 = 12.444444…), six decimals reconcile
  // after cent rounding. Integer-only: scale by 10^6 and floor, never float.
  const RATE_DECIMALS = 6n;
  const rateScale = 10n ** RATE_DECIMALS;
  const rateScaled = (config.phpPerUsdc * rateScale) / config.myrPerUsdc;
  const rateWhole = rateScaled / rateScale;
  const rateFrac = rateScaled % rateScale;
  const rateText = `1 MYR = ${rateWhole.toString()}.${rateFrac.toString().padStart(Number(RATE_DECIMALS), "0")} PHP`;

  const issuedAt = now;
  const expiresAt = now + config.quoteTtlMs;

  const beneficiaryRef = deriveBeneficiaryRef(intent.recipient, issuedAt);

  const envelope: QuoteEnvelope = {
    kind: "quote",
    recipient: intent.recipient,
    destinationCity: intent.destinationCity,
    destinationCountry: MYR_PHP_CORRIDOR.destinationCountry,
    youPayMinor: sendAmount.toString(),
    youPayCurrency: "MYR",
    familyReceivesMinor: familyReceivesPhp.toString(),
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText },
    totalFeeMinor: totalFee.toString(),
    feeCurrency: "MYR",
    fixedFeeMinor: config.fixedFeeMyr.toString(),
    feeBps: config.feeBps,
    usdcMicro: usdcMicro.toString(),
    usdcAmount: formatUsdc(usdcMicro.toString()),
    settlementRail: MYR_PHP_CORRIDOR.settlementRail,
    payoutMethod: config.payoutMethod,
    estimatedArrival: config.estimatedArrival,
    payoutStatus: "Awaiting payout partner",
    issuedAt,
    expiresAt,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: config.myrPerUsdc.toString(),
      phpPerUsdc: config.phpPerUsdc.toString(),
      fixedFeeMyr: config.fixedFeeMyr.toString(),
      feeBps: config.feeBps,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress,
    beneficiaryRef,
    attestation: null,
    clarification: null,
  };

  return envelope;
}

/** Format MYR sen as a decimal MYR string for clarification reasons. */
function formatMyrMinor(myrSen: bigint): string {
  const divisor = 100n;
  const whole = myrSen / divisor;
  const frac = myrSen % divisor;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(2, "0").replace(/0+$/, "")}`;
}

/**
 * Derive a non-PII quote/beneficiary reconciliation reference from the
 * beneficiary alias and quote issuedAt. The reference is a stable 8-character
 * uppercase alphanumeric token (FNV-1a hash of alias + issuedAt). It is NOT
 * on-chain; it is off-chain metadata only — the on-chain beneficiary binding is
 * the exact unique destination address.
 */
export function deriveBeneficiaryRef(alias: string, issuedAt: number): string {
  const seed = `${alias.trim().toLowerCase()}|${issuedAt}`;
  const bytes = new TextEncoder().encode(seed);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ref = "R-";
  let v = h >>> 0;
  for (let i = 0; i < 8; i++) {
    ref += alphabet[v % 36];
    v = Math.floor(v / 36);
  }
  return ref;
}
