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

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Two decimals below 100, whole dollars above, so large strikes stay readable. */
export function formatSettlementUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(usd) < 100 ? 2 : 0,
  }).format(usd);
}

/** 6-decimal micro contract count as a plain decimal string, or null when malformed. */
export function formatContractsMicro(micro: string): string | null {
  if (!/^\d+$/.test(micro)) return null;
  const value = BigInt(micro);
  if (value <= 0n) return null;
  const whole = value / 1_000_000n;
  const fraction = value % 1_000_000n;
  if (fraction === 0n) return whole.toString();
  const fractionDigits = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fractionDigits}`;
}

/** UTC "Sep 4, 2026 · 00:00"; null when the input is not a valid date. */
export function formatMatchedAtUtc(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${day} · ${time} UTC`;
}
