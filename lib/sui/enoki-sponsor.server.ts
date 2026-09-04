import "server-only";

import { EnokiClient } from "@mysten/enoki";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { resolveProtectedTransferConfig } from "@/lib/remittance/protected-transfer-config.server";
import {
  buildProtectedTransfer,
  parseProtectedTransferExecutionPlan,
} from "@/lib/remittance/protected-transfer";
import { verifyRemittanceQuote } from "@/lib/remittance/quote-verification.server";
import {
  SponsoredProtectedTransferRequestSchema,
  type SponsoredCreateResponse,
  type SponsoredExecuteResponse,
} from "./sponsored-transaction";
import { inspectSponsoredProtectedTransferKind } from "./sponsor-policy.server";

interface EnokiSponsorClient {
  createSponsoredTransaction(input: {
    network: "testnet";
    sender: string;
    transactionKindBytes: string;
    allowedAddresses: string[];
    allowedMoveCallTargets: string[];
  }): Promise<{ bytes: string; digest: string }>;
  executeSponsoredTransaction(input: {
    digest: string;
    signature: string;
  }): Promise<{ digest: string }>;
}

type EnokiSponsorClientFactory = (apiKey: string) => EnokiSponsorClient;

let enokiSponsorClientFactoryForTest: EnokiSponsorClientFactory | null = null;

export function __setEnokiSponsorClientFactoryForTest(
  factory: EnokiSponsorClientFactory | null,
): void {
  enokiSponsorClientFactoryForTest = factory;
}

function clientFor(apiKey: string): EnokiSponsorClient {
  return (enokiSponsorClientFactoryForTest ??
    ((key: string) => new EnokiClient({ apiKey: key })))(apiKey);
}

function privateApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.ENOKI_PRIVATE_API_KEY?.trim();
  return key && key.length >= 16 && key.length <= 512 ? key : null;
}

export async function createSponsoredProtectedTransfer(input: {
  request: unknown;
  nowMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<SponsoredCreateResponse> {
  const key = privateApiKey(input.env);
  if (!key) return { kind: "unavailable", reason: "not_configured" };
  const parsed = SponsoredProtectedTransferRequestSchema.safeParse(input.request);
  if (!parsed.success) return { kind: "unavailable", reason: "not_allowed" };
  const request = parsed.data;

  try {
    const sender = normalizeSuiAddress(request.sender);
    const plan = parseProtectedTransferExecutionPlan(request.plan, input.nowMs);
    const config = resolveProtectedTransferConfig(input.env);
    if (
      !config.ok ||
      plan.packageId !== config.config.packageId ||
      plan.reviewerAddress !== config.config.reviewerAddress
    ) {
      return { kind: "unavailable", reason: "not_allowed" };
    }

    const quote = verifyRemittanceQuote({
      body: request.quote,
      evidenceMode: false,
      nowMs: input.nowMs,
      env: input.env,
    });
    if (
      quote.kind !== "authorization" ||
      JSON.stringify(quote) !== JSON.stringify(plan.authorization)
    ) {
      return { kind: "unavailable", reason: "not_allowed" };
    }

    const built = buildProtectedTransfer({ plan, sender, nowMs: input.nowMs });
    const inspection = inspectSponsoredProtectedTransferKind(
      request.transactionKindBytes,
      {
        packageId: built.metadata.packageId,
        coinType: built.metadata.coinType,
        beneficiaryAddress: built.metadata.beneficiary,
        reviewerAddress: built.metadata.reviewer,
        amountMicro: built.metadata.amountMicro,
        deadlineMs: built.metadata.deadlineMs,
        commitmentHex: built.metadata.commitmentHex,
        ...(plan.sealedEvidence === undefined
          ? {}
          : {
              sealIdHex: plan.sealedEvidence.sealIdHex,
              walrusBlobId: plan.sealedEvidence.walrusBlobId,
            }),
      },
    );

    let sponsored: { bytes: string; digest: string };
    try {
      sponsored = await clientFor(key).createSponsoredTransaction({
        network: "testnet",
        sender,
        transactionKindBytes: request.transactionKindBytes,
        allowedAddresses: [sender, built.metadata.beneficiary, built.metadata.reviewer],
        allowedMoveCallTargets: inspection.moveCallTargets,
      });
    } catch {
      return { kind: "unavailable", reason: "provider_error" };
    }
    if (
      typeof sponsored.bytes !== "string" ||
      sponsored.bytes.length === 0 ||
      sponsored.bytes.length > 65_536 ||
      typeof sponsored.digest !== "string" ||
      sponsored.digest.length === 0 ||
      sponsored.digest.length > 120
    ) {
      return { kind: "unavailable", reason: "provider_error" };
    }
    return { kind: "sponsored", bytes: sponsored.bytes, digest: sponsored.digest };
  } catch {
    return { kind: "unavailable", reason: "not_allowed" };
  }
}

export async function executeSponsoredTransaction(input: {
  digest: string;
  signature: string;
  env: NodeJS.ProcessEnv;
}): Promise<SponsoredExecuteResponse> {
  const key = privateApiKey(input.env);
  if (!key) return { kind: "unavailable", reason: "not_configured" };
  try {
    const executed = await clientFor(key).executeSponsoredTransaction({
      digest: input.digest,
      signature: input.signature,
    });
    if (
      typeof executed.digest !== "string" ||
      executed.digest.length === 0 ||
      executed.digest.length > 120
    ) {
      return { kind: "unavailable", reason: "provider_error" };
    }
    return { kind: "submitted", digest: executed.digest };
  } catch {
    return { kind: "unavailable", reason: "provider_error" };
  }
}
