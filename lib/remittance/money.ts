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
