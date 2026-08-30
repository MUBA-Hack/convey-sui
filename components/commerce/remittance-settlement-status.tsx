import {
  SuiSettlementVerificationResponseSchema,
  type SuiSettlementRejectedReason,
  type SuiSettlementVerificationResponse,
} from "@/lib/remittance/sui-settlement-response";

export type SettlementRejectedReason =
  | SuiSettlementRejectedReason
  | "transaction_not_found";

type VerifiedSettlementEvidence = Omit<
  Extract<SuiSettlementVerificationResponse, { kind: "verified" }>,
  "kind"
>;

export type SettlementCheckState =
  | { status: "checking" }
  | {
      status: "verified";
      evidence: VerifiedSettlementEvidence;
    }
  | { status: "rejected"; reason: SettlementRejectedReason }
  | { status: "unavailable"; reason: "rpc_unavailable" | "invalid_response" };

export interface ExpectedSettlementEvidence {
  digest: string;
  recipientAddress: string;
  receivedMicro: string;
}

export function parseSettlementCheckResponse(
  value: unknown,
  expected: ExpectedSettlementEvidence,
): SettlementCheckState {
  const parsed = SuiSettlementVerificationResponseSchema.safeParse(value);
  if (!parsed.success) {
    return { status: "unavailable", reason: "invalid_response" };
  }
  const response = parsed.data;
  if (response.kind === "verified") {
    if (
      response.digest !== expected.digest ||
      response.recipientAddress !== expected.recipientAddress ||
      response.receivedMicro !== expected.receivedMicro
    ) {
      return { status: "unavailable", reason: "invalid_response" };
    }
    return {
      status: "verified",
      evidence: {
        network: "testnet",
        digest: response.digest,
        coinType: response.coinType,
        recipientAddress: response.recipientAddress,
        receivedMicro: response.receivedMicro,
        checkedAt: response.checkedAt,
      },
    };
  }
  if (response.kind === "rejected") {
    return {
      status: "rejected",
      reason: response.reason,
    };
  }
  if (response.kind === "not_found" && response.reason === "transaction_not_found") {
    return { status: "rejected", reason: "transaction_not_found" };
  }
  if (response.kind === "unavailable" && response.reason === "rpc_unavailable") {
    return { status: "unavailable", reason: "rpc_unavailable" };
  }
  return { status: "unavailable", reason: "invalid_response" };
}

export function RemittanceSettlementStatus({
  state,
  onRetry,
  onReview,
}: {
  state: SettlementCheckState;
  onRetry: () => void;
  onReview: () => void;
}) {
  const notFound = state.status === "rejected" && state.reason === "transaction_not_found";
  const title =
    state.status === "checking"
      ? "Checking transfer on Sui"
      : state.status === "verified"
        ? "Confirmed on Sui"
        : state.status === "unavailable"
          ? "Sui check unavailable"
          : notFound
            ? "Transaction not found on Sui testnet"
            : "Receipt doesn’t match Sui";
  const body =
    state.status === "checking"
      ? "Matching the digest, recipient, and USDC amount."
      : state.status === "verified"
        ? "Digest, recipient, amount, and testnet network match."
        : state.status === "unavailable"
          ? "No independent Sui result is available yet."
          : notFound
            ? "No matching testnet transaction was returned."
            : "The Sui result differs from this receipt.";

  return (
    <section
      data-testid="remittance-transfer-status"
      data-settlement-status={state.status}
      aria-live="polite"
      className="mt-5 rounded-2xl border border-black/12 bg-white p-5 sm:p-6"
    >
      <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Transfer status
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-black">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-neutral-600">{body}</p>
      {state.status === "unavailable" ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-black px-4 text-xs font-semibold text-white transition hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
        >
          Try again
        </button>
      ) : state.status === "rejected" ? (
        <button
          type="button"
          onClick={onReview}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-black px-4 text-xs font-semibold text-white transition hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto"
        >
          Review details
        </button>
      ) : null}
    </section>
  );
}

export function FamilyPayoutStatus({
  recipient,
  settlementVerified,
}: {
  recipient: string;
  settlementVerified: boolean;
}) {
  return (
    <section
      data-testid="remittance-family-payout"
      className="mt-3 rounded-2xl border border-black/10 bg-neutral-50 p-5"
    >
      <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Family payout
      </p>
      <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-black">
        Awaiting family payout
      </h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">
        {settlementVerified
          ? `USDC is confirmed on Sui. ${recipient}’s bank or cash payout has not been confirmed.`
          : "No bank or cash payout has been confirmed."}
      </p>
    </section>
  );
}
