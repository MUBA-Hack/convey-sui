/**
 * Pure client-safe helpers shared by the home money sheet and the quote
 * settlement sheet's structured editor.
 *
 * No React, no network, no secret, no quote-builder import. Amount validation
 * mirrors the parser/quote-builder bounds so a typed amount is rejected with
 * the same reason the server would give, before any fetch.
 */

import {
  formatMyr,
  formatMyrFixedGrouped,
  formatPhpFixedGrouped,
  formatUsdcGrouped,
} from "./money";
import { MYR_PHP_CORRIDOR, MAX_SEND_MYR_SEN, DEFAULT_CONFIG } from "./constants";
import type { QuoteEnvelope } from "./quote-schema";

export function titleCaseCity(city: string): string {
  return city
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Curated supported destination cities — one clean label per place. */
export const CITY_OPTIONS: { label: string; alias: string }[] = [
  { label: "Manila", alias: "manila" },
  { label: "Cebu", alias: "cebu" },
  { label: "Quezon City", alias: "quezon city" },
  { label: "Davao", alias: "davao" },
  { label: "Makati", alias: "makati" },
  { label: "Pasig", alias: "pasig" },
  { label: "Taguig", alias: "taguig" },
];

const MIN_SEND_MYR_SEN = DEFAULT_CONFIG.minSendMyr; // 100n = 1.00 MYR

/** Validate a typed MYR amount against the parser/quote-builder bounds. */
export function parseAmountToMinor(
  raw: string,
): { ok: true; minor: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Enter an amount." };
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, reason: "Use a plain MYR amount, e.g. 500." };
  }
  const cleaned = trimmed.replace(/,/g, "");
  const [intPart, fracPart = ""] = cleaned.split(".");
  if (fracPart.length > 2) return { ok: false, reason: "Use up to two decimals." };
  const fracPadded = (fracPart + "00").slice(0, 2);
  const minor = BigInt(intPart + fracPadded).toString();
  const n = BigInt(minor);
  if (n < MIN_SEND_MYR_SEN) return { ok: false, reason: "Minimum send is 1 MYR." };
  if (n > MAX_SEND_MYR_SEN) return { ok: false, reason: "Maximum send is 1,000 MYR." };
  return { ok: true, minor };
}

export function estimatePhpPayout(amountMinor: string): string | null {
  const send = BigInt(amountMinor);
  const fee =
    DEFAULT_CONFIG.fixedFeeMyr +
    (send * BigInt(DEFAULT_CONFIG.feeBps)) / 10_000n;
  const convertible = send - fee;
  if (convertible <= 0n) return null;
  const usdcMicro = (convertible * 1_000_000n) / DEFAULT_CONFIG.myrPerUsdc;
  const phpMinor = (usdcMicro * DEFAULT_CONFIG.phpPerUsdc) / 1_000_000n;
  return phpMinor > 0n ? formatPhpFixedGrouped(phpMinor.toString()) : null;
}

export function estimateMyrFee(amountMinor: string): string {
  const send = BigInt(amountMinor);
  const fee =
    DEFAULT_CONFIG.fixedFeeMyr +
    (send * BigInt(DEFAULT_CONFIG.feeBps)) / 10_000n;
  return formatMyrFixedGrouped(fee.toString());
}

export function isValidRecipient(name: string): boolean {
  if (name.length < 1 || name.length > 40) return false;
  return /^[A-Za-z][A-Za-z' -]{0,39}$/.test(name);
}

/** Build a reconstructable send command from structured fields. */
export function buildCommand(amount: string, recipient: string, cityAlias: string): string {
  return `Send RM${amount.trim()} to ${recipient.trim()} in ${titleCaseCity(cityAlias)}`;
}

/** Build a refresh command from the current quote (same entered values). */
export function buildRefreshCommand(quote: QuoteEnvelope): string {
  return `Send RM${formatMyr(quote.youPayMinor)} to ${quote.recipient} in ${titleCaseCity(
    quote.destinationCity,
  )}`;
}

/** Resolve a quote's destination city to a supported CITY_OPTIONS alias. */
export function resolveCityAlias(city: string): string {
  const lower = city.toLowerCase();
  return (
    CITY_OPTIONS.find((c) => c.alias === lower)?.alias ??
    (MYR_PHP_CORRIDOR.destinationAliases.includes(lower) ? lower : CITY_OPTIONS[0]!.alias)
  );
}

/**
 * Pure quote presentation view model — every formatted string the settlement
 * sheet renders, computed once. Uses FIXED two-decimal money for the primary
 * hierarchy and the fee/converted rows so figures read as exact finance
 * typesetting (`RM9.50`, `RM490.50`, `₱6,104.00`), never ragged.
 */
export interface QuoteViewModel {
  sendAmount: string; // RM500.00
  phpPayout: string; // 6,104.00
  fee: string; // 9.50
  converted: string; // 490.50
  usdcAmount: string; // 109 (USDC keeps its canonical grouping)
  city: string; // Manila
  recipientCityCountry: string; // Ana · Manila, Philippines
  monogram: string; // A
}

export function buildQuoteViewModel(quote: QuoteEnvelope): QuoteViewModel {
  const convertedMinor = (BigInt(quote.youPayMinor) - BigInt(quote.totalFeeMinor)).toString();
  const city = titleCaseCity(quote.destinationCity);
  return {
    sendAmount: formatMyrFixedGrouped(quote.youPayMinor),
    phpPayout: formatPhpFixedGrouped(quote.familyReceivesMinor),
    fee: formatMyrFixedGrouped(quote.totalFeeMinor),
    converted: formatMyrFixedGrouped(convertedMinor),
    usdcAmount: formatUsdcGrouped(quote.usdcMicro),
    city,
    recipientCityCountry: `${quote.recipient} · ${city}, ${quote.destinationCountry}`,
    monogram: quote.recipient.charAt(0).toUpperCase() || "·",
  };
}
