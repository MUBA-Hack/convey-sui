/**
 * Client-safe integer minor-unit formatting helpers.
 *
 * Pure BigInt math — no floating point, no network, no secret, no quote-builder
 * import. Lets components format amounts without importing the quote builder.
 */

/** Format a minor-unit integer string as a decimal currency string. */
export function formatMinor(amountMinor: string, decimals: number): string {
  const n = BigInt(amountMinor);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Format a minor-unit integer string as a decimal currency string with a FIXED
 * number of decimal places (trailing zeros preserved). Same BigInt arithmetic
 * as `formatMinor`; only the fractional padding differs. Use this for money
 * figures that must read as exact two-decimal finance typesetting
 * (e.g. `RM9.50`, `RM490.50`, `₱6,104.00`) — never the ragged `RM9.5`.
 */
export function formatMinorFixed(amountMinor: string, decimals: number): string {
  const n = BigInt(amountMinor);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Insert `,` thousands separators into the integer part of a decimal string.
 * Pure and locale-independent: the separator is always `,` and grouping is
 * always three-digit groups from the right, so output is deterministic across
 * runtimes and never depends on `Intl`/host locale. The fractional part (if
 * any) is left untouched. A leading `-` is preserved.
 */
export function groupInteger(decimal: string): string {
  const negative = decimal.startsWith("-");
  const body = negative ? decimal.slice(1) : decimal;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot);
  // Group the integer part from the right in fixed 3-digit chunks.
  let grouped = "";
  for (let i = 0; i < intPart.length; i++) {
    const fromRight = intPart.length - i;
    if (i > 0 && fromRight % 3 === 0) grouped += ",";
    grouped += intPart[i]!;
  }
  return `${negative ? "-" : ""}${grouped}${fracPart}`;
}

/**
 * Format a minor-unit integer string as a decimal currency string WITH
 * deterministic `,` thousands grouping in the integer part. Same arithmetic as
 * `formatMinor`; only the display grouping differs. Canonical integer strings
 * and arithmetic are never changed.
 */
export function formatMinorGrouped(amountMinor: string, decimals: number): string {
  return groupInteger(formatMinor(amountMinor, decimals));
}

/** Fixed-decimal grouped variant — exact decimals with `,` integer grouping. */
export function formatMinorFixedGrouped(amountMinor: string, decimals: number): string {
  return groupInteger(formatMinorFixed(amountMinor, decimals));
}

/** Format USDC micro-units as a decimal USDC string (6 decimals), grouped. */
export function formatUsdcGrouped(usdcMicro: string): string {
  return formatMinorGrouped(usdcMicro, 6);
}

/** Format MYR sen as a decimal MYR string (2 decimals), grouped. */
export function formatMyrGrouped(myrSen: string): string {
  return formatMinorGrouped(myrSen, 2);
}

/** Format PHP centavos as a decimal PHP string (2 decimals), grouped. */
export function formatPhpGrouped(phpCentavos: string): string {
  return formatMinorGrouped(phpCentavos, 2);
}

/** Format USDC micro-units as a decimal USDC string (6 decimals). */
export function formatUsdc(usdcMicro: string): string {
  return formatMinor(usdcMicro, 6);
}

/** Format MYR sen as a decimal MYR string (2 decimals). */
export function formatMyr(myrSen: string): string {
  return formatMinor(myrSen, 2);
}

/** Format PHP centavos as a decimal PHP string (2 decimals). */
export function formatPhp(phpCentavos: string): string {
  return formatMinor(phpCentavos, 2);
}

/** Fixed two-decimal MYR sen string with `,` grouping (e.g. `9.50`, `490.50`). */
export function formatMyrFixed(myrSen: string): string {
  return formatMinorFixed(myrSen, 2);
}

/** Fixed two-decimal MYR sen string with `,` grouping (e.g. `9.50`, `1,000.00`). */
export function formatMyrFixedGrouped(myrSen: string): string {
  return formatMinorFixedGrouped(myrSen, 2);
}

/** Fixed two-decimal PHP centavos string with `,` grouping (e.g. `6,104.00`). */
export function formatPhpFixedGrouped(phpCentavos: string): string {
  return formatMinorFixedGrouped(phpCentavos, 2);
}
