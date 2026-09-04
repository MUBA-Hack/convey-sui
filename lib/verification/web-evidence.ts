import { z } from "zod";
import { ClaimVerificationReportSchema } from "./claim-report";

export const WEB_QUERY_MAX_LENGTH = 500;
export const WEB_VERIFICATION_REQUEST_MAX_BYTES = 2_048;

export const WebVerificationRequestSchema = z.strictObject({
  query: z.string().trim().min(8).max(WEB_QUERY_MAX_LENGTH),
});
export type WebVerificationRequest = z.infer<typeof WebVerificationRequestSchema>;

export const WebEvidenceSourceSchema = z.strictObject({
  id: z.string().regex(/^source-[1-6]$/u),
  url: z.string().url().max(2_048),
  host: z.string().trim().min(1).max(253),
  title: z.string().trim().min(1).max(240),
  publishedAt: z.string().datetime().nullable(),
  snippet: z.string().trim().min(1).max(420),
});
export type WebEvidenceSource = z.infer<typeof WebEvidenceSourceSchema>;

export const GroundedCitationSchema = z.strictObject({
  sourceId: z.string().regex(/^source-[1-6]$/u),
  url: z.string().url().max(2_048),
  title: z.string().trim().min(1).max(240),
  quote: z.string().trim().min(1).max(360),
});
export type GroundedCitation = z.infer<typeof GroundedCitationSchema>;

export const WebVerificationResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("web_verified_report"),
    query: z.string().trim().min(8).max(WEB_QUERY_MAX_LENGTH),
    searchWindow: z.enum(["30d", "3m"]),
    searchedAt: z.string().datetime(),
    report: ClaimVerificationReportSchema,
    sources: z.array(WebEvidenceSourceSchema).min(2).max(6),
    citations: z.array(GroundedCitationSchema).min(1).max(12),
  }),
  z.strictObject({
    kind: z.literal("web_verification_unavailable"),
    reason: z.enum([
      "invalid_input",
      "search_unavailable",
      "insufficient_sources",
      "verification_unavailable",
    ]),
  }),
]);
export type WebVerificationResponse = z.infer<typeof WebVerificationResponseSchema>;

export async function requestWebVerification(
  request: WebVerificationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<WebVerificationResponse> {
  const response = await fetchImpl("/api/verification/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(WebVerificationRequestSchema.parse(request)),
  });
  const parsed = WebVerificationResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Web verification service returned an invalid response.");
  return parsed.data;
}
