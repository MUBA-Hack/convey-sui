const USDC_MICRO = 1_000_000;
const STRIKE_8D = 100_000_000;

export function formatUsdcMicro(micro: string): string {
  const value = Number(micro);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value / USDC_MICRO);
}

export function formatStrike(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

export function formatStrike8d(strike8d: string): string {
  return formatStrike(Number(strike8d) / STRIKE_8D);
}

export function formatProtectionExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatProtectionExpirySeconds(seconds: string): string {
  return new Date(Number(seconds) * 1_000).toLocaleDateString();
}
