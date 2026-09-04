import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";
import type { ProtectedTransferExecutionPlan } from "@/lib/remittance/protected-transfer";
import {
  SponsoredCreateResponseSchema,
  SponsoredExecuteResponseSchema,
  type SponsoredCreateResponse,
  type SponsoredExecuteResponse,
} from "./sponsored-transaction";

async function parseNoStoreResponse<T>(input: {
  response: Response;
  parse: (value: unknown) => T;
}): Promise<T> {
  if (!input.response.ok) throw new Error("Sponsored transaction service failed.");
  return input.parse(await input.response.json());
}

export async function requestSponsoredProtectedTransfer(input: {
  sender: string;
  quote: QuoteEnvelope;
  plan: ProtectedTransferExecutionPlan;
  transactionKindBytes: string;
  fetchImpl?: typeof fetch;
}): Promise<SponsoredCreateResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/sui/sponsor/protected-transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sender: input.sender,
      quote: input.quote,
      plan: input.plan,
      transactionKindBytes: input.transactionKindBytes,
    }),
    cache: "no-store",
  });
  return parseNoStoreResponse({
    response,
    parse: (value) => SponsoredCreateResponseSchema.parse(value),
  });
}

export async function submitSponsoredProtectedTransfer(input: {
  digest: string;
  signature: string;
  fetchImpl?: typeof fetch;
}): Promise<SponsoredExecuteResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/sui/sponsor/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ digest: input.digest, signature: input.signature }),
    cache: "no-store",
  });
  return parseNoStoreResponse({
    response,
    parse: (value) => SponsoredExecuteResponseSchema.parse(value),
  });
}
