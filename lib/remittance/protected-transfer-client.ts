import {
  ProtectedTransferPlanRequestSchema,
  ProtectedTransferPlanResponseSchema,
  type ProtectedTransferPlanRequest,
  type ProtectedTransferPlanResponse,
} from "./protected-transfer";

export interface ProtectedTransferPlanClientInput {
  request: ProtectedTransferPlanRequest;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface ProtectedTransferPlanClientResult {
  response: ProtectedTransferPlanResponse;
}

export async function requestProtectedTransferPlan(
  input: ProtectedTransferPlanClientInput,
): Promise<ProtectedTransferPlanClientResult> {
  const parsedRequest = ProtectedTransferPlanRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new Error("Protected Transfer plan request failed strict schema validation.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? "/api/remittance/protected-transfer/plan";

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedRequest.data),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Protected Transfer plan response was not valid JSON.");
  }

  const parsed = ProtectedTransferPlanResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Protected Transfer plan response failed strict schema validation.");
  }

  return { response: parsed.data };
}
