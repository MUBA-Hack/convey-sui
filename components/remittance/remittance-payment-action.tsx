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
  isTypedWalletRejection,
  isValidDigest,
  resolveTransferMode,
  type RemittanceWalletErrorCode,
} from "@/lib/remittance/transfer";
import {
  verifySettlement,
  type SettlementEvidence,
} from "@/lib/remittance/sui-settlement-verification";
import { formatUsdcGrouped } from "@/lib/remittance/money";
import { formatMyr } from "@/lib/remittance/quote";
import { RemittanceReceiptActions } from "./remittance-receipt-actions";
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
 * - explicit chain failure (FailedTransaction / status.success=false): unlock, retryable
 * - valid digest + verified balance change: confirmed
 * - valid digest + timeout/provider error / unverified mismatch: submitted pending, lock
 * - any other post-sign outcome: unknown, lock, never retry
 */

export interface RemittancePaymentActionProps {
  quote: QuoteEnvelope;
  /**
   * When true, the parent (checkout dialog) renders the consumer summary card
   * and the collapsed "Transfer details" disclosure, so this action hides its
   * own pre-confirm technical rows and only renders the Confirm/Cancel controls
   * and the post-submit lifecycle surfaces (error / unknown / submitted-pending
   * / settlement). Default false keeps the standalone behavior intact.
   */
  summaryMode?: boolean;
  /**
   * When true, the confirmed-settlement card omits the Share/Export receipt
   * actions. Used by the offline handoff flow, where the parent handoff card
   * renders its own receipt actions for the same settlement — preventing
   * duplicate Share/Export controls when both surfaces are mounted.
   */
  suppressReceiptActions?: boolean;
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
  /** Verified family-rule purpose carried from the authorized quote, or null. */
  purpose: string | null;
  /** Verified family-rule max cap in minor MYR, or null. */
  maximumFamilyLimitMinor: string | null;
  /**
   * Epoch ms at which the on-chain settlement was confirmed (finality success
   * observed). Bound once at confirmation so repeated share/export of the
   * receipt produces identical evidence, not a new timestamp per share.
   */
  confirmedAt: number;
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
  over_cap: "This transfer exceeds the verified family limit. Get a new quote to continue.",
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
  summaryMode = false,
  suppressReceiptActions = false,
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
  const usdcAmount = formatUsdcGrouped(quote.usdcMicro);
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

      // v2 waitForTransaction via the core API: the SuiJsonRpcClient's own
      // waitForTransaction is the deprecated v1 shape (GetTransactionBlockParams
      // + SuiTransactionBlockResponse). The .core property is a JSONRpcCoreClient
      // extending CoreClient, which has the v2 include/timeout/pollSchedule API.
      // No cast around the client result.
      let evidence: SettlementEvidence;
      try {
        const txResult = await client.core.waitForTransaction({
          digest: digestOrNull,
          include: { balanceChanges: true },
          timeout: 15_000,
          pollSchedule: [0, 300, 600, 1500, 3500],
        });
        if (!mountedRef.current) return;
        evidence = verifySettlement({
          expectedDigest: digestOrNull,
          expectedRecipientAddress: auth.recipientAddress,
          expectedUsdcMicro: auth.usdcMicro,
          result: txResult,
        });
      } catch {
        // Timeout/provider error after digest exists: stay submitted-pending,
        // never onSettled, never retryable.
        if (!mountedRef.current) return;
        lockSubmitted(digestOrNull);
        return;
      }
      if (!mountedRef.current) return;

      if (evidence.kind === "verified") {
        const real: RemittanceSettlement = {
          mode: "real",
          digest: digestOrNull,
          explorerUrl: buildExplorerUrl(digestOrNull),
          usdcMicro: auth.usdcMicro,
          recipientAddress: auth.recipientAddress,
          quoteExpiresAt: auth.expiresAt,
          beneficiaryRef: auth.beneficiaryRef,
          payoutStatus: "Awaiting payout partner",
          purpose: auth.purpose,
          maximumFamilyLimitMinor: auth.maximumFamilyLimitMinor,
          // Bound once at confirmation so repeated share/export produces
          // identical evidence, not a new timestamp per share.
          confirmedAt: Date.now(),
        };
        setSettlement(real);
        setStatus("confirmed");
        onPendingChange?.(false);
        onTerminal?.({ kind: "confirmed", settlement: real });
        onSettled?.(real);
        return;
      }
      if (evidence.kind === "failed") {
        unlockRetryable("failure", evidence.error ?? "Transfer failed on-chain.");
        onTerminal?.({
          kind: "failed",
          message: evidence.error ?? "Transfer failed on-chain.",
        });
        return;
      }
      // Unverified mismatch after digest exists: stay submitted-pending,
      // never onSettled, never retryable.
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
      {!summaryMode && (
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
      )}

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
              {/* Rule verified row — only when the verified authorization
                  actually carries a rule (purpose or per-transfer maximum).
                  Ordinary transfers render no rule row, so a no-rule transfer
                  never implies a rule was verified. */}
              {(settlement.purpose || settlement.maximumFamilyLimitMinor) && (
                <div className="mt-1 border-t border-black/10 pt-2">
                  <p
                    data-testid="remittance-rule-verified"
                    className="text-[11px] leading-relaxed text-neutral-600"
                  >
                    Rule verified
                    {settlement.purpose
                      ? ` · ${settlement.purpose.charAt(0).toUpperCase()}${settlement.purpose.slice(1)}`
                      : ""}
                    {settlement.maximumFamilyLimitMinor
                      ? ` · Within RM${formatMyr(settlement.maximumFamilyLimitMinor)} maximum`
                      : ""}
                  </p>
                </div>
              )}
            </dl>
          </div>
          {/* Confirmed-only receipt actions — share/export a tamper-evident
              receipt ONLY after a real testnet settlement is confirmed. The
              receipt is built from the verified quote and the captured
              settlement evidence, then validated against the strict receipt
              schema. No signature or authorization is implied. Suppressed
              when a parent (e.g. the offline handoff card) renders its own
              receipt actions for the same settlement. */}
          {!suppressReceiptActions && (
            <RemittanceReceiptActions quote={quote} settlement={settlement} />
          )}
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
            Testnet transfer is unavailable for this corridor right now. No USDC has
            moved and no MYR has been charged.
          </p>
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
