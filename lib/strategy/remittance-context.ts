export interface RemittanceContext {
  source: "remittance";
  amountMyr: number;
  recipient: string;
  city: string;
}

const MAX_RECIPIENT_LEN = 40;
const MAX_CITY_LEN = 40;
const MIN_NOTIONAL = 1;
const MAX_NOTIONAL = 1_000_000;

type SearchValue = string | string[] | undefined;

function firstValue(raw: SearchValue): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

function sanitizeDisplay(raw: SearchValue, maxLen: number): string | null {
  const first = firstValue(raw);
  if (first === null) return null;
  const cleaned = first.replace(/[\u0000-\u001F\u007F<>]/g, "").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function sanitizeAmountMyr(raw: SearchValue): number | null {
  const first = firstValue(raw);
  if (first === null) return null;
  const cleaned = first.replace(/[^\d.]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(Math.floor(n), MIN_NOTIONAL), MAX_NOTIONAL);
}

export function parseRemittanceContext(
  params: Record<string, SearchValue>,
): RemittanceContext | null {
  if (firstValue(params.source) !== "remittance") return null;

  const amountMyr = sanitizeAmountMyr(params.amountMyr);
  const recipient = sanitizeDisplay(params.recipient, MAX_RECIPIENT_LEN);
  const city = sanitizeDisplay(params.city, MAX_CITY_LEN);
  if (amountMyr === null || recipient === null || city === null) return null;

  return { source: "remittance", amountMyr, recipient, city };
}
