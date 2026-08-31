import type { z } from "zod";
import {
  FamilyStewardRequestSchema,
  FamilyStewardResponseSchema,
  type FamilyStewardResponse,
} from "./family-steward";

export type FamilyStewardClientRequest = z.input<
  typeof FamilyStewardRequestSchema
>;

export interface FamilyStewardClientInput {
  request: FamilyStewardClientRequest;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  signal?: AbortSignal;
}

export interface FamilyStewardClientResult {
  response: FamilyStewardResponse;
}

export async function requestFamilyStewardReview(
  input: FamilyStewardClientInput,
): Promise<FamilyStewardClientResult> {
  const request = FamilyStewardRequestSchema.safeParse(input.request);
  if (!request.success) {
    throw new Error("Family Steward request failed strict schema validation.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? "/api/remittance/family-steward";
  const result = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.data),
    signal: input.signal,
  });

  let body: unknown;
  try {
    body = await result.json();
  } catch {
    throw new Error("Family Steward response was not valid JSON.");
  }

  const response = FamilyStewardResponseSchema.safeParse(body);
  if (!response.success) {
    throw new Error("Family Steward response failed strict schema validation.");
  }
  return { response: response.data };
}
