import { z } from "zod";
import {
  QuoteEnvelopeSchema,
  type QuoteEnvelope,
} from "./quote-schema";

export const REMITTANCE_HANDOFF_KIND = "convey.remittance-quote" as const;
export const REMITTANCE_HANDOFF_VERSION = 1 as const;
export const REMITTANCE_HANDOFF_MAX_BYTES = 16 * 1024;

export const RemittanceHandoffSchema = z.strictObject({
  kind: z.literal(REMITTANCE_HANDOFF_KIND),
  version: z.literal(REMITTANCE_HANDOFF_VERSION),
  quote: QuoteEnvelopeSchema,
});

export type RemittanceHandoff = z.infer<typeof RemittanceHandoffSchema>;

export type RemittanceHandoffErrorReason =
  | "malformed_json"
  | "oversized"
  | "wrong_kind"
  | "unsupported_version"
  | "invalid_shape";

export class RemittanceHandoffError extends Error {
  readonly reason: RemittanceHandoffErrorReason;
  constructor(reason: RemittanceHandoffErrorReason, message: string) {
    super(`remittance-handoff/${reason}: ${message}`);
    this.name = "RemittanceHandoffError";
    this.reason = reason;
  }
}

function fail(reason: RemittanceHandoffErrorReason, detail: string): never {
  throw new RemittanceHandoffError(reason, detail);
}

export function wrapQuote(quote: QuoteEnvelope): RemittanceHandoff {
  const parsed = QuoteEnvelopeSchema.safeParse(quote);
  if (!parsed.success) {
    fail("invalid_shape", "inner quote failed strict schema");
  }
  return {
    kind: REMITTANCE_HANDOFF_KIND,
    version: REMITTANCE_HANDOFF_VERSION,
    quote: parsed.data,
  };
}

export function encodeHandoff(handoff: RemittanceHandoff): string {
  return JSON.stringify({
    kind: handoff.kind,
    version: handoff.version,
    quote: handoff.quote,
  });
}

export function sniffHandoffKind(
  raw: string,
): "convey.remittance-quote" | "qr-ferry" | "unknown" {
  if (typeof raw !== "string" || raw.length === 0) return "unknown";
  if (raw.length > REMITTANCE_HANDOFF_MAX_BYTES) return "unknown";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unknown";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "unknown";
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind === REMITTANCE_HANDOFF_KIND) return "convey.remittance-quote";
  if (typeof o.version === "number" && o.kind === undefined) return "qr-ferry";
  return "unknown";
}

export function decodeHandoff(
  raw: string,
  opts: { maxBytes?: number } = {},
): RemittanceHandoff {
  if (typeof raw !== "string" || raw.length === 0) {
    fail("malformed_json", "empty payload");
  }
  const maxBytes = opts.maxBytes ?? REMITTANCE_HANDOFF_MAX_BYTES;
  if (raw.length > maxBytes) {
    fail("oversized", `payload exceeds ${maxBytes} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("malformed_json", "input is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("invalid_shape", "payload must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind !== REMITTANCE_HANDOFF_KIND) {
    fail("wrong_kind", `kind=${String(o.kind)}`);
  }
  if (o.version !== REMITTANCE_HANDOFF_VERSION) {
    fail("unsupported_version", `version=${String(o.version)}`);
  }
  const result = RemittanceHandoffSchema.safeParse(parsed);
  if (!result.success) {
    fail("invalid_shape", "handoff failed strict schema");
  }
  return result.data;
}
