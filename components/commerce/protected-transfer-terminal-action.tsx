"use client";

import { useEffect, useRef, useState } from "react";
import {
  useCurrentAccount,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import { dAppKit } from "@/components/wallet/providers";
import {
  buildProtectedTransferTerminal,
  type ProtectedTransferTerminalAction,
  type ProtectedTransferTerminalVerifyRequest,
} from "@/lib/remittance/protected-transfer-terminal";
import { requestProtectedTransferTerminalVerification } from "@/lib/remittance/protected-transfer-client";
import {
  buildProtectedTransferTerminalReceipt,
  encodeProtectedTransferTerminalReceiptPayload,
  PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM,
} from "@/lib/remittance/protected-transfer-terminal-receipt";
import type { VerifiedProtectedTransferCreatedReceipt } from "@/lib/remittance/protected-transfer-created-receipt";
import {
  buildExplorerUrl,
  extractSuccessfulDigest,
  isTypedWalletRejection,
  isValidDigest,
} from "@/lib/remittance/transfer";

export interface ResolveTerminalActionInput {
  accountAddress: string | null;
  network: string;
  createdVerified: boolean;
  payerAddress: string;
  reviewerAddress: string;
  deadlineMs: number;
  nowMs: number;
}

export function resolveProtectedTransferTerminalAction(
  input: ResolveTerminalActionInput,
): ProtectedTransferTerminalAction | null {
  if (!input.createdVerified || input.network !== "testnet" || !input.accountAddress) {
    return null;
  }
  let account: string;
  try {
    account = normalizeSuiAddress(input.accountAddress);
  } catch {
    return null;
  }
  if (!isValidSuiAddress(account)) return null;
  if (account === input.reviewerAddress && input.nowMs <= input.deadlineMs) {
    return "release";
  }
  if (account === input.payerAddress && input.nowMs > input.deadlineMs) {
    return "refund";
  }
  return null;
}

type ActionStatus =
  | "idle"
  | "signing"
  | "verifying"
  | "wallet_rejected"
  | "failed"
  | "unknown"
  | "not_found"
  | "review_needed"
  | "unavailable";

interface SubmittedTerminalAction {
  action: ProtectedTransferTerminalAction;
  digest: string;
}

interface ProtectedTransferTerminalActionProps {
  receipt: VerifiedProtectedTransferCreatedReceipt;
  createdVerified: boolean;
  nowMs?: () => number;
  navigate?: (url: string) => void;
}

function terminalRequest(
  receipt: VerifiedProtectedTransferCreatedReceipt,
  action: ProtectedTransferTerminalAction,
  digest: string,
): ProtectedTransferTerminalVerifyRequest {
  const transfer = receipt.document.transfer;
  return {
    action,
    digest,
    packageId: transfer.packageId,
    escrowObjectId: transfer.escrowObjectId,
    payerAddress: transfer.payerAddress,
    beneficiaryAddress: transfer.beneficiaryAddress,
    reviewerAddress: transfer.reviewerAddress,
    amountMicro: transfer.amountMicro,
    deadlineMs: transfer.deadlineMs,
    evidenceCommitmentHex: transfer.evidenceCommitmentHex,
  };
}

function statusCopy(status: ActionStatus): string | null {
  if (status === "signing") return "Approve this action in your wallet.";
  if (status === "verifying") return "Confirming the outcome on Sui…";
  if (status === "wallet_rejected") return "Wallet request canceled. Nothing was submitted.";
  if (status === "failed") return "The action failed. Check your wallet and try again.";
  if (status === "unknown") return "Outcome unknown. Check your wallet activity before taking another action.";
  if (status === "not_found") return "Sui has not confirmed this transaction yet.";
  if (status === "review_needed") return "The transaction did not match this hold. Review its details before continuing.";
  if (status === "unavailable") return "The action was submitted, but confirmation is temporarily unavailable.";
  return null;
}

export function ProtectedTransferTerminalAction({
  receipt,
  createdVerified,
  nowMs = Date.now,
  navigate = (url) => window.location.assign(url),
}: ProtectedTransferTerminalActionProps) {
  const account = useCurrentAccount({ dAppKit });
  const network = useCurrentNetwork({ dAppKit });
  const wallet = useDAppKit(dAppKit);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [submitted, setSubmitted] = useState<SubmittedTerminalAction | null>(null);
  const [now, setNow] = useState(() => nowMs());
  const locked = useRef(false);
  const verificationRunning = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), 1_000);
    return () => window.clearInterval(timer);
  }, [nowMs]);

  const transfer = receipt.document.transfer;
  const action = resolveProtectedTransferTerminalAction({
    accountAddress: account?.address ?? null,
    network,
    createdVerified,
    payerAddress: transfer.payerAddress,
    reviewerAddress: transfer.reviewerAddress,
    deadlineMs: transfer.deadlineMs,
    nowMs: now,
  });

  const displayAction = submitted?.action ?? action;
  if (!displayAction) return null;
  const terminalAction = displayAction;

  const busy = status === "signing" || status === "verifying";
  const label = terminalAction === "release" ? "Release funds" : "Refund payer";

  async function verifySubmitted(next: SubmittedTerminalAction) {
    if (verificationRunning.current) return;
    verificationRunning.current = true;
    setStatus("verifying");
    let verification;
    try {
      verification = await requestProtectedTransferTerminalVerification({
        request: terminalRequest(receipt, next.action, next.digest),
      });
    } catch {
      verificationRunning.current = false;
      setStatus("unavailable");
      return;
    }
    verificationRunning.current = false;

    if (verification.response.kind === "unavailable") {
      setStatus("unavailable");
      return;
    }
    if (verification.response.kind === "not_found") {
      setStatus("not_found");
      return;
    }
    if (verification.response.kind === "rejected") {
      setStatus("review_needed");
      return;
    }
    if (
      verification.response.action !== next.action ||
      verification.response.digest !== next.digest
    ) {
      setStatus("review_needed");
      return;
    }

    try {
      const terminalReceipt = buildProtectedTransferTerminalReceipt({
        createdReceipt: receipt.document,
        terminal: verification.response,
      });
      const payload = encodeProtectedTransferTerminalReceiptPayload(terminalReceipt);
      navigate(`/proof?${PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM}=${payload}`);
    } catch {
      setStatus("review_needed");
    }
  }

  async function submit() {
    if (locked.current || busy || !account) return;
    const currentAction = resolveProtectedTransferTerminalAction({
      accountAddress: account.address,
      network,
      createdVerified,
      payerAddress: transfer.payerAddress,
      reviewerAddress: transfer.reviewerAddress,
      deadlineMs: transfer.deadlineMs,
      nowMs: nowMs(),
    });
    if (currentAction !== terminalAction) return;

    locked.current = true;
    setStatus("signing");
    let signingBegan = false;
    let digest: string | null = null;
    try {
      const built = buildProtectedTransferTerminal({
        source: {
          action: terminalAction,
          packageId: transfer.packageId,
          escrowObjectId: transfer.escrowObjectId,
          payerAddress: transfer.payerAddress,
          beneficiaryAddress: transfer.beneficiaryAddress,
          reviewerAddress: transfer.reviewerAddress,
          coinType: transfer.coinType,
          amountMicro: transfer.amountMicro,
          deadlineMs: transfer.deadlineMs,
          evidenceCommitmentHex: transfer.evidenceCommitmentHex,
        },
        sender: account.address,
        nowMs: nowMs(),
      });
      signingBegan = true;
      const result = await wallet.signAndExecuteTransaction({ transaction: built.transaction });
      digest = extractSuccessfulDigest(result);
      if (digest === null) {
        setStatus("unknown");
        return;
      }
      if (!isValidDigest(digest)) {
        setStatus("unknown");
        return;
      }
      const next = { action: terminalAction, digest };
      setSubmitted(next);
      await verifySubmitted(next);
    } catch (error) {
      if (digest) {
        setStatus("unavailable");
        return;
      }
      if (signingBegan && isTypedWalletRejection(error)) {
        locked.current = false;
        setStatus("wallet_rejected");
        return;
      }
      if (signingBegan) {
        setStatus("unknown");
        return;
      }
      locked.current = false;
      setStatus("failed");
    }
  }

  const message = statusCopy(status);
  const canRetryVerification =
    submitted !== null && (status === "not_found" || status === "unavailable");
  return (
    <div className="mt-5 rounded-2xl border border-black/10 bg-neutral-50 p-4" data-testid="protected-transfer-terminal-action">
      <p className="text-sm font-semibold text-black">
        {terminalAction === "release" ? "Ready for your review" : "The review window has ended"}
      </p>
      <p className="mt-1 text-xs leading-5 text-neutral-600">
        {terminalAction === "release"
          ? `Release the held funds to ${transfer.recipient}.`
          : "Return the held funds to the payer."}
      </p>
      {!submitted && status !== "unknown" ? (
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-black px-5 text-xs font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-55 motion-reduce:transition-none"
        >
          {busy ? "Working…" : label}
        </button>
      ) : null}
      {submitted ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href={buildExplorerUrl(submitted.digest)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-xl border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/40 motion-reduce:transition-none"
          >
            View transaction
          </a>
          {canRetryVerification || status === "verifying" ? (
            <button
              type="button"
              onClick={() => verifySubmitted(submitted)}
              disabled={status === "verifying"}
              className="inline-flex min-h-11 items-center rounded-xl bg-black px-4 text-xs font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-55 motion-reduce:transition-none"
            >
              {status === "verifying" ? "Checking…" : "Check outcome again"}
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 text-xs leading-5 text-neutral-700" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
