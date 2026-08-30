"use client";

import { useEffect, useRef, useState } from "react";
import {
  useCurrentAccount,
  useCurrentClient,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { Warning2 } from "@/components/icons";
import {
  authorizationToTransferInput,
  bindAuthorizationToQuote,
  buildExplorerUrl,
  buildUsdcTransfer,
  classifyPreSignError,
  extractSuccessfulDigest,
  inspectFinality,
  isTypedWalletRejection,
  isValidDigest,
  resolveTransferMode,
  type RemittanceWalletErrorCode,
  type WaitForTransactionResponse,
} from "@/lib/remittance/transfer";
import { formatUsdc } from "@/lib/remittance/money";
import {
  CanonicalAuthorizationSchema,
  isExpired,
  type QuoteEnvelope,
} from "@/lib/remittance/quote-schema";

/**
 * Remittance USDC payment action.
 *
 * real — wallet + testnet + mapped recipient + structural attestation.
 * prepared — otherwise. No pseudo-receipts.
 *
 * Lifecycle after signing begins is fail-closed:
 * - typed wallet rejection before a known result: unlock, retryable
 * - structural FailedTransaction / effects.status=failure: unlock, retryable
 * - valid digest + effects success: confirmed
 * - valid digest + missing effects / finality error: submitted pending, lock
 * - any other post-sign outcome: unknown, lock, never retry
 */

export interface RemittancePaymentActionProps {
  quote: QuoteEnvelope;
  onCancel?: () => void;
  onSettled?: (result: RemittanceSettlement) => void;
  onPendingChange?: (pending: boolean) => void;
  onTerminal?: (state: RemittanceTerminalState) => void;
}

export interface RemittanceSettlement {
  mode: "real";
  digest: string;
  explorerUrl: string;
  usdcMicro: string;
  recipientAddress: string;
  quoteExpiresAt: number;
  beneficiaryRef: string;
  payoutStatus: "Awaiting payout partner";
}

export type RemittanceTerminalState =
  | { kind: "submitted"; digest: string; explorerUrl: string }
  | { kind: "unknown" }
  | { kind: "confirmed"; settlement: RemittanceSettlement }
  | { kind: "failed"; message: string };

const ERROR_MESSAGES: Record<RemittanceWalletErrorCode, string> = {
  rejection: "Signature request canceled. No transfer was submitted.",
  insufficient: "This wallet does not have enough USDC balance for the transfer and gas.",
  failure: "Transfer failed. Check the wallet and your balance, then try again.",
  expired: "Quote expired — get a new quote.",
  verification: "This quote could not be verified. Get a new quote to continue.",
};

function shortAddress(addr: string | null): string {
  if (!addr) return "Not configured";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type Status =
  | "idle"
  | "pending"
  | "submitted"
  | "submitted_pending"
  | "unknown"
  | "confirmed"
  | "error";

export function RemittancePaymentAction({
  quote,
  onCancel,
  onSettled,
  onPendingChange,
  onTerminal,
}: RemittancePaymentActionProps) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const client = useCurrentClient();

  const [status, setStatus] = useState<Status>("idle");
  const [settlement, setSettlement] = useState<RemittanceSettlement | null>(null);
  const [errorCode, setErrorCode] = useState<RemittanceWalletErrorCode | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [pendingDigest, setPendingDigest] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  const verificationRef = useRef<AbortController | null>(null);
  const currentAccountRef = useRef(account?.address ?? null);
  const currentNetworkRef = useRef(network);
  useEffect(() => {
    currentAccountRef.current = account?.address ?? null;
    currentNetworkRef.current = network;
  }, [account?.address, network]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      verificationRef.current?.abort();
    };
  }, []);

  const quoteExpired = isExpired(quote.expiresAt, now);
  const mode = resolveTransferMode({
    account: account?.address ?? null,
    network,
    authorizedRecipient: quote.recipientAddress,
    attestation: quote.attestation,
  });
  const usdcAmount = formatUsdc(quote.usdcMicro);
  const recipientAddress = quote.recipientAddress;
  const isReal = mode === "real" && !quoteExpired;
  const terminal =
    status === "submitted" ||
    status === "submitted_pending" ||
    status === "unknown" ||
    status === "confirmed";

  function unlockRetryable(code: RemittanceWalletErrorCode, detail?: string) {
    lockRef.current = false;
    setErrorCode(code);
    setErrorDetail(detail ?? null);
    setStatus("error");
    onPendingChange?.(false);
  }

  function lockUnknown() {
    setStatus("unknown");
    onPendingChange?.(true);
    onTerminal?.({ kind: "unknown" });
  }

  function lockSubmitted(digest: string) {
    setPendingDigest(digest);
    setStatus("submitted_pending");
    onPendingChange?.(true);
    onTerminal?.({ kind: "submitted", digest, explorerUrl: buildExplorerUrl(digest) });
  }

  async function handleConfirm() {
    if (lockRef.current) return;
    if (status !== "idle" && status !== "error") return;
    if (isExpired(quote.expiresAt, Date.now())) {
      setErrorCode("expired");
      setStatus("error");
      return;
    }
    if (!isReal || !recipientAddress || !account) return;

    lockRef.current = true;
    setStatus("pending");
    setErrorCode(null);
    setErrorDetail(null);
    setSettlement(null);
    setPendingDigest(null);
    onPendingChange?.(true);

    let signingBegan = false;
    let capturedDigest: string | null = null;

    try {
      const verification = new AbortController();
      verificationRef.current = verification;
      const verifyRes = await fetch("/api/remittance/quote/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quote),
        signal: verification.signal,
      });
      if (!mountedRef.current) return;
      if (!verifyRes.ok) {
        unlockRetryable("verification");
        return;
      }

      const verifyBody = await verifyRes.json();
      if (!mountedRef.current) return;
      verificationRef.current = null;
      const authResult = CanonicalAuthorizationSchema.safeParse(verifyBody);
      if (!authResult.success) {
        unlockRetryable("verification");
        return;
      }
      const auth = authResult.data;
      if (isExpired(auth.expiresAt, Date.now())) {
        unlockRetryable("expired");
        return;
      }
      if (bindAuthorizationToQuote(auth, quote) !== null) {
        unlockRetryable("verification");
        return;
      }
      if (
        currentAccountRef.current !== account.address ||
        currentNetworkRef.current !== "testnet"
      ) {
        unlockRetryable("verification");
        return;
      }

      const tx = buildUsdcTransfer(authorizationToTransferInput(auth, account.address));
      signingBegan = true;
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (!mountedRef.current) return;

      const digestOrNull = extractSuccessfulDigest(result);
      if (digestOrNull === null) {
        // Structural FailedTransaction from dAppKit.
        unlockRetryable("failure");
        onTerminal?.({ kind: "failed", message: "Transfer failed on-chain." });
        return;
      }
      if (!isValidDigest(digestOrNull)) {
        // Invalid/missing digest after signing is unknown, never retryable.
        lockUnknown();
        return;
      }

      capturedDigest = digestOrNull;
      setPendingDigest(digestOrNull);
      setStatus("submitted");
      onTerminal?.({
        kind: "submitted",
        digest: digestOrNull,
        explorerUrl: buildExplorerUrl(digestOrNull),
      });

      let finality: WaitForTransactionResponse;
      try {
        finality = (await client.waitForTransaction({
          digest: digestOrNull,
          options: { showEffects: true },
        })) as WaitForTransactionResponse;
      } catch {
        if (!mountedRef.current) return;
        lockSubmitted(digestOrNull);
        return;
      }
      if (!mountedRef.current) return;

      const outcome = inspectFinality(finality, digestOrNull);
      if (outcome === "success") {
        const real: RemittanceSettlement = {
          mode: "real",
          digest: digestOrNull,
          explorerUrl: buildExplorerUrl(digestOrNull),
          usdcMicro: auth.usdcMicro,
          recipientAddress: auth.recipientAddress,
          quoteExpiresAt: auth.expiresAt,
          beneficiaryRef: auth.beneficiaryRef,
          payoutStatus: "Awaiting payout partner",
        };
        setSettlement(real);
        setStatus("confirmed");
        onPendingChange?.(false);
        onTerminal?.({ kind: "confirmed", settlement: real });
        onSettled?.(real);
        return;
      }
      if (outcome === "failure") {
        unlockRetryable(
          "failure",
          finality.effects?.status?.error ?? "Transfer failed on-chain.",
        );
        onTerminal?.({
          kind: "failed",
          message: finality.effects?.status?.error ?? "Transfer failed on-chain.",
        });
        return;
      }
      // Missing effects: retain lock, show submitted pending.
      lockSubmitted(digestOrNull);
    } catch (error) {
      if (!mountedRef.current) return;

      if (!signingBegan) {
        unlockRetryable(classifyPreSignError(error));
        return;
      }

      // After signing begins: typed rejection unlocks; everything else is unknown
      // unless a digest was already captured (then submitted pending).
      if (isTypedWalletRejection(error) && !capturedDigest) {
        unlockRetryable("rejection");
        return;
      }
      if (capturedDigest) {
        lockSubmitted(capturedDigest);
        return;
      }
      lockUnknown();
    }
  }

  return (
    <div className="space-y-4" aria-label="USDC remittance transfer action">
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Settlement</span>
          <span className="font-mono tabular-nums text-foreground">{usdcAmount} USDC</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Recipient</span>
          <span className="font-mono text-foreground" title={recipientAddress ?? undefined}>
            {shortAddress(recipientAddress)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Reference</span>
          <span className="font-mono text-xs text-foreground">{quote.beneficiaryRef}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Rail</span>
          <span className="text-foreground">{quote.settlementRail}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Status</span>
          {quoteExpired ? (
            <span className="font-semibold text-foreground">Quote expired</span>
          ) : isReal ? (
            <span className="font-semibold text-foreground">Real testnet transfer</span>
          ) : (
            <span className="font-semibold text-foreground">Prepared — not submitted</span>
          )}
        </div>
      </div>

      {status === "error" && errorCode && (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <Warning2 size="18" variant="Bold" className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{errorDetail ?? ERROR_MESSAGES[errorCode]}</p>
        </div>
      )}

      {status === "unknown" && (
        <div
          data-testid="remittance-unknown"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <Warning2 size="18" variant="Bold" className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>Transfer outcome unknown — check your wallet before taking any action.</p>
        </div>
      )}

      {status === "submitted_pending" && pendingDigest && (
        <div
          data-testid="remittance-submitted-pending"
          className="space-y-2 rounded-xl border border-black/12 bg-[#f7f7f5] p-4 text-sm"
        >
          <p className="font-medium text-black">Submitted — confirmation pending</p>
          <p className="text-neutral-600">
            The transfer was submitted but could not be confirmed yet. Check your wallet or the
            explorer before taking any action.
          </p>
          <p
            data-testid="remittance-digest"
            className="truncate font-mono text-xs text-black"
            title={pendingDigest}
            data-full={pendingDigest}
          >
            {pendingDigest}
          </p>
          <a
            href={buildExplorerUrl(pendingDigest)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline"
          >
            View on SuiScan
          </a>
        </div>
      )}

      {settlement && status === "confirmed" && (
        <div data-testid="remittance-settlement" className="space-y-3">
          <div className="rounded-xl border border-black/12 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              Transaction digest
            </p>
            <p
              data-testid="remittance-digest"
              className="mt-1 truncate font-mono text-xs text-black"
              title={settlement.digest}
              data-full={settlement.digest}
            >
              {settlement.digest}
            </p>
            <a
              href={settlement.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/15 bg-white px-2.5 text-[11px] font-semibold text-black underline-offset-4 hover:border-black/40 hover:underline"
            >
              View on SuiScan
            </a>
            <dl className="mt-3 space-y-1.5 border-t border-black/10 pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Amount</dt>
                <dd className="font-mono tabular-nums">{usdcAmount} USDC</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Recipient</dt>
                <dd className="font-mono text-xs" title={settlement.recipientAddress}>
                  {shortAddress(settlement.recipientAddress)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Reference</dt>
                <dd className="font-mono text-xs">{settlement.beneficiaryRef}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Quote expiry</dt>
                <dd className="font-mono tabular-nums text-xs">
                  {new Date(settlement.quoteExpiresAt).toISOString()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-500">Payout status</dt>
                <dd className="font-semibold">Awaiting payout partner</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {quoteExpired ? (
        <div
          data-testid="remittance-expired"
          className="rounded-xl border border-black/12 bg-[#f7f7f5] p-4 text-sm"
        >
          <p className="font-medium text-black">Quote expired — get a new quote</p>
          <button
            type="button"
            className="cv-btn-ghost mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onCancel}
          >
            Close
          </button>
        </div>
      ) : isReal ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="cv-btn-ghost min-h-[44px] flex-1 rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onCancel}
            disabled={terminal || status === "pending"}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cv-btn-solid min-h-[44px] flex-1 rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={handleConfirm}
            disabled={terminal || status === "pending"}
            aria-busy={status === "pending" || status === "submitted"}
          >
            {status === "pending"
              ? "Verifying…"
              : status === "submitted"
                ? "Submitted — confirming…"
                : status === "submitted_pending"
                  ? "Submitted — confirmation pending"
                  : status === "unknown"
                    ? "Outcome unknown"
                    : status === "confirmed"
                      ? "Confirmed"
                      : "Confirm transfer"}
          </button>
        </div>
      ) : (
        <div
          data-testid="remittance-prepared"
          className="rounded-xl border border-black/12 bg-[#f7f7f5] p-4 text-sm"
        >
          <p className="font-medium text-black">Prepared — not submitted</p>
          <p className="mt-1 text-neutral-600">
            A real testnet USDC transfer requires a connected wallet on testnet, a verified
            recipient address for this quote, and a valid quote attestation.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-600">
            {!account && <li>Connect a Sui wallet.</li>}
            {account && network !== "testnet" && <li>Switch the wallet to testnet.</li>}
            {!recipientAddress && <li>Configure a recipient Sui address for this beneficiary.</li>}
            {recipientAddress && !quote.attestation && (
              <li>Quote attestation is missing — get a new quote.</li>
            )}
          </ul>
          <button
            type="button"
            className="cv-btn-ghost mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-xs font-medium uppercase tracking-wide"
            onClick={onCancel}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
