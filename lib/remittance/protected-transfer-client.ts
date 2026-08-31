import {
  ProtectedTransferPlanRequestSchema,
  ProtectedTransferPlanResponseSchema,
  type ProtectedTransferPlanRequest,
  type ProtectedTransferPlanResponse,
} from "./protected-transfer";
import {
  ProtectedTransferCreatedVerifyRequestSchema,
  ProtectedTransferCreatedVerifyResponseSchema,
  type ProtectedTransferCreatedVerifyRequest,
  type ProtectedTransferCreatedVerifyResponse,
} from "./protected-transfer-created";
import {
  ProtectedTransferTerminalVerifyRequestSchema,
  ProtectedTransferTerminalVerifyResponseSchema,
  type ProtectedTransferTerminalVerifyRequest,
  type ProtectedTransferTerminalVerifyResponse,
} from "./protected-transfer-terminal";
import {
  ProtectedTransferOpenRequestSchema,
  ProtectedTransferOpenResponseSchema,
  type ProtectedTransferOpenRequest,
  type ProtectedTransferOpenResponse,
} from "./protected-transfer-open";

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

export interface ProtectedTransferCreatedVerifyClientInput {
  request: ProtectedTransferCreatedVerifyRequest;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface ProtectedTransferCreatedVerifyClientResult {
  response: ProtectedTransferCreatedVerifyResponse;
}

/**
 * Request an independent Created-event verification from the fixed-testnet,
 * read-only server route. The client never selects RPC, network, or coin type;
 * it only sends the exact expectation captured at wallet submission and returns
 * the strict safe response union. A malformed response throws — callers keep
 * the submitted hold state and never turn a parse failure into success.
 */
export async function requestProtectedTransferCreatedVerification(
  input: ProtectedTransferCreatedVerifyClientInput,
): Promise<ProtectedTransferCreatedVerifyClientResult> {
  const parsedRequest = ProtectedTransferCreatedVerifyRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new Error("Protected Transfer Created verify request failed strict schema validation.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? "/api/remittance/protected-transfer/created/verify";

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedRequest.data),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Protected Transfer Created verify response was not valid JSON.");
  }

  const parsed = ProtectedTransferCreatedVerifyResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Protected Transfer Created verify response failed strict schema validation.");
  }

  return { response: parsed.data };
}

export interface ProtectedTransferTerminalVerifyClientInput {
  request: ProtectedTransferTerminalVerifyRequest;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface ProtectedTransferTerminalVerifyClientResult {
  response: ProtectedTransferTerminalVerifyResponse;
}

/**
 * Request an independent terminal-event verification from the fixed-testnet,
 * read-only server route. Malformed JSON/schema throws — callers keep the
 * submitted terminal state and never turn a parse failure into success.
 */
export async function requestProtectedTransferTerminalVerification(
  input: ProtectedTransferTerminalVerifyClientInput,
): Promise<ProtectedTransferTerminalVerifyClientResult> {
  const parsedRequest = ProtectedTransferTerminalVerifyRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new Error("Protected Transfer terminal verify request failed strict schema validation.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? "/api/remittance/protected-transfer/terminal/verify";

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedRequest.data),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Protected Transfer terminal verify response was not valid JSON.");
  }

  const parsed = ProtectedTransferTerminalVerifyResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Protected Transfer terminal verify response failed strict schema validation.");
  }

  return { response: parsed.data };
}

export interface ProtectedTransferOpenClientInput {
  request: ProtectedTransferOpenRequest;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export interface ProtectedTransferOpenClientResult {
  response: ProtectedTransferOpenResponse;
}

/**
 * Request one bounded open-state read from the fixed-testnet, read-only
 * server route. Malformed JSON/schema throws — callers never turn a parse
 * failure into an optimistic `open`.
 */
export async function requestProtectedTransferOpen(
  input: ProtectedTransferOpenClientInput,
): Promise<ProtectedTransferOpenClientResult> {
  const parsedRequest = ProtectedTransferOpenRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new Error("Protected Transfer open request failed strict schema validation.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? "/api/remittance/protected-transfer/terminal/open";

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedRequest.data),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Protected Transfer open response was not valid JSON.");
  }

  const parsed = ProtectedTransferOpenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Protected Transfer open response failed strict schema validation.");
  }

  return { response: parsed.data };
}
