"use client";

import { useId, useRef, useState } from "react";
import { ExportSquare, Refresh, ShieldTick, Wallet, Warning2 } from "@/components/icons";
import { ProtectionPurchaseReceipt } from "@/components/strategy/protection-purchase-receipt";
import {
  ProtectionPurchasePlanResponseSchema,
  ProtectionPurchasePlanSummarySchema,
  ProtectionPurchaseTransactionSchema,
  type ProtectionPurchasePlanResponse,
  type ProtectionPurchasePlanSummary,
  type ProtectionPurchaseTransaction,
} from "@/lib/strategy/protection-purchase";
import {
  ProtectionPurchaseVerifyResponseSchema,
  buildBaseScanTransactionUrl,
  buildProtectionPurchaseReceipt,
  encodeProtectionPurchaseReceiptPayload,
  parseTransactionHash,
  PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM,
  type ProtectionPurchaseReceiptDocument,
} from "@/lib/strategy/protection-purchase-receipt";
import { formatUsdcMicro } from "@/lib/strategy/format";
import { recordActivity } from "@/lib/activity/storage";
import type { ActivityItem } from "@/lib/activity/types";
import {
  ProtectionWalletError,
  connectBaseWallet,
  getInjectedEip1193Provider,
  sendPreparedTransaction,
  validatePreparedProtectionTransaction,
  waitForWalletTransaction,
  type Eip1193Provider,
} from "@/lib/strategy/protection-purchase-wallet";

const PLAN_ROUTE = "/api/strategy/protection/plan";
const VERIFY_ROUTE = "/api/strategy/protection/verify";
const RECOVERY_KEY = "convey:protection-purchase-lock:v1";
const RECOVERY_VERSION = 2 as const;

type ActionPhase =
  | { kind: "wallet"; message?: string }
  | { kind: "preparing" }
  | {
      kind: "approval_ready";
      account: string;
      plan: ProtectionPurchasePlanSummary;
      transaction: ProtectionPurchaseTransaction;
      message?: string;
    }
  | { kind: "approval_pending"; hash: `0x${string}`; account: string; plan: ProtectionPurchasePlanSummary; message?: string }
  | {
      kind: "fill_ready";
      account: string;
      plan: ProtectionPurchasePlanSummary;
      transaction: ProtectionPurchaseTransaction;
      approvalHash: `0x${string}` | null;
      message?: string;
    }
  | { kind: "filling" }
  | {
      kind: "submitted";
      hash: `0x${string}`;
      plan: ProtectionPurchasePlanSummary;
      approvalHash: `0x${string}` | null;
      checking: boolean;
      message?: string;
    }
  | { kind: "needs_review"; hash: `0x${string}` | null; message: string }
  | { kind: "active"; receipt: ProtectionPurchaseReceiptDocument; href: string };

interface ProtectionWalletActionProps {
  goal: string;
  premiumBudgetUsd: number;
  offerFingerprint: string;
  provider?: Eip1193Provider | null;
  fetcher?: typeof fetch;
  onAdjust: () => void;
  recovery?: ProtectionPurchaseRecovery | null;
}

interface ProtectionPurchaseRecoveryBase {
  version: typeof RECOVERY_VERSION;
  generation: number;
  flowId: string;
  goal: string;
  premiumBudgetUsd: number;
  offerFingerprint: string;
  plan: ProtectionPurchasePlanSummary;
  approvalHash: `0x${string}` | null;
}

export type ProtectionPurchaseRecovery = ProtectionPurchaseRecoveryBase & (
  | { kind: "ready" }
  | { kind: "approval_intent"; transaction: ProtectionPurchaseTransaction }
  | { kind: "approval_submitted"; transaction: ProtectionPurchaseTransaction; hash: `0x${string}` }
  | { kind: "fill_intent"; transaction: ProtectionPurchaseTransaction }
  | { kind: "fill_submitted"; transaction: ProtectionPurchaseTransaction; hash: `0x${string}` }
  | { kind: "verified"; transaction: ProtectionPurchaseTransaction; hash: `0x${string}` }
);

function isFingerprint(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

export function readProtectionPurchaseRecovery(): ProtectionPurchaseRecovery | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(RECOVERY_KEY) ?? "null") as Record<string, unknown> | null;
    if (!value || value.version !== RECOVERY_VERSION) return null;
    if (!Number.isSafeInteger(value.generation) || Number(value.generation) < 0) return null;
    if (typeof value.flowId !== "string" || value.flowId.length < 8) return null;
    if (typeof value.goal !== "string" || typeof value.premiumBudgetUsd !== "number") return null;
    if (!isFingerprint(value.offerFingerprint)) return null;
    const approvalHash = value.approvalHash === null ? null : parseTransactionHash(value.approvalHash);
    if (value.approvalHash !== null && !approvalHash) return null;
    const plan = ProtectionPurchasePlanSummarySchema.safeParse(value.plan);
    if (!plan.success || plan.data.orderFingerprint !== value.offerFingerprint) return null;
    const base: ProtectionPurchaseRecoveryBase = {
      version: RECOVERY_VERSION,
      generation: Number(value.generation),
      flowId: value.flowId,
      goal: value.goal,
      premiumBudgetUsd: value.premiumBudgetUsd,
      offerFingerprint: value.offerFingerprint,
      plan: plan.data,
      approvalHash,
    };
    if (value.kind === "ready") return { ...base, kind: "ready" };
    const transaction = ProtectionPurchaseTransactionSchema.safeParse(value.transaction);
    if (!transaction.success) return null;
    if (value.kind === "approval_intent" || value.kind === "fill_intent") {
      return { ...base, kind: value.kind, transaction: transaction.data };
    }
    const hash = parseTransactionHash(value.hash);
    if (
      (value.kind === "approval_submitted" || value.kind === "fill_submitted" || value.kind === "verified") &&
      hash
    ) {
      return { ...base, kind: value.kind, transaction: transaction.data, hash };
    }
    return null;
  } catch {
    return null;
  }
}

function writeProtectionPurchaseRecovery(value: ProtectionPurchaseRecovery): void {
  if (typeof window === "undefined") throw new ProtectionWalletError("failed", "Durable browser storage is unavailable.");
  const serialized = JSON.stringify(value);
  window.localStorage.setItem(RECOVERY_KEY, serialized);
  if (window.localStorage.getItem(RECOVERY_KEY) !== serialized) {
    throw new ProtectionWalletError("failed", "Durable browser storage is unavailable.");
  }
}

function hasProtectionPurchaseRecoverySlot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(RECOVERY_KEY) !== null;
  } catch {
    return true;
  }
}

function samePurchaseTerms(a: ProtectionPurchasePlanSummary, b: ProtectionPurchasePlanSummary): boolean {
  const fields: ReadonlyArray<keyof ProtectionPurchasePlanSummary> = [
    "chainId",
    "account",
    "asset",
    "orderFingerprint",
    "signatureHash",
    "optionBook",
    "collateralToken",
    "maker",
    "nonce",
    "signedOrderExpirySeconds",
    "expirySeconds",
    "pricePerContract8d",
    "premiumCapMicro",
    "estimatedPremiumMicro",
    "allowanceAmountMicro",
    "numContractsMicro",
    "referrer",
    "fillDataHash",
  ];
  return fields.every((field) => a[field] === b[field]) &&
    a.strikes8d.length === b.strikes8d.length &&
    a.strikes8d.every((strike, index) => strike === b.strikes8d[index]);
}

async function withBrowserPurchaseLock<T>(work: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & {
        locks?: { request<R>(name: string, options: { mode: "exclusive" }, callback: (lock: unknown) => Promise<R>): Promise<R> };
      }).locks;
  if (!lockManager) {
    throw new ProtectionWalletError("failed", "Browser transaction locking is unavailable.");
  }
  return lockManager.request("convey-protection-purchase", { mode: "exclusive" }, work);
}

function walletMessage(error: unknown): string {
  if (!(error instanceof ProtectionWalletError)) {
    return "The wallet could not complete this request. Try again.";
  }
  if (error.code === "provider_missing") return "Install or open a Base wallet to continue.";
  if (error.code === "account_mismatch") return "The connected wallet changed. Reconnect the wallet you reviewed.";
  if (error.code === "wrong_chain") return "Switch your wallet to Base, then try again.";
  if (error.code === "rejected") return "Wallet request canceled. Nothing was purchased.";
  if (error.code === "reverted") return "The wallet transaction did not complete. Nothing was purchased.";
  return "The wallet could not complete this request. Try again.";
}

export function protectionPurchaseActivityItem(
  receipt: ProtectionPurchaseReceiptDocument,
  payload: string,
): ActivityItem {
  return {
    id: `treasury:protection:${receipt.purchase.txHash}`,
    href: `/proof?${PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM}=${payload}`,
    title: "Treasury protection position",
    amountLabel: `${formatUsdcMicro(receipt.purchase.premiumAmountMicro)} USDC`,
    detailLabel: `${receipt.plan.asset} protection on Base`,
    nextOwner: "You",
    updatedAt: receipt.purchase.checkedAt,
  };
}

function PlanError({ message }: { message: string }) {
  return (
    <p className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-neutral-700" role="alert">
      <Warning2 size="17" variant="Linear" className="mt-0.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

export function ProtectionWalletAction({
  goal,
  premiumBudgetUsd,
  offerFingerprint,
  provider: suppliedProvider,
  fetcher = fetch,
  onAdjust,
  recovery = null,
}: ProtectionWalletActionProps) {
  const generatedFlowId = `flow-${useId()}`;
  const flowIdRef = useRef(recovery?.flowId ?? generatedFlowId);
  const generationRef = useRef(recovery?.generation ?? 0);
  const approvalHashRef = useRef<`0x${string}` | null>(recovery?.approvalHash ?? null);
  const [phase, setPhase] = useState<ActionPhase>(() => {
    if (!recovery || recovery.kind === "ready") return { kind: "wallet" };
    if (recovery.kind === "approval_submitted") {
      return { kind: "approval_pending", hash: recovery.hash, account: recovery.plan.account, plan: recovery.plan };
    }
    if (recovery.kind === "fill_submitted" || recovery.kind === "verified") {
      return {
        kind: "submitted",
        hash: recovery.hash,
        plan: recovery.plan,
        approvalHash: recovery.approvalHash,
        checking: false,
        message: "This purchase was already submitted. Check its current status.",
      };
    }
    return {
      kind: "needs_review",
      hash: null,
      message: "A wallet request may have been submitted, but its transaction reference was not saved. Check your wallet activity before doing anything else.",
    };
  });

  function recoveryBase(plan: ProtectionPurchasePlanSummary, approvalHash: `0x${string}` | null): ProtectionPurchaseRecoveryBase {
    return {
      version: RECOVERY_VERSION,
      generation: generationRef.current,
      flowId: flowIdRef.current,
      goal,
      premiumBudgetUsd,
      offerFingerprint,
      plan,
      approvalHash,
    };
  }

  function ownsRecovery(value: ProtectionPurchaseRecovery | null): boolean {
    if (value === null) return !hasProtectionPurchaseRecoverySlot();
    return (
      value.kind === "ready" &&
      value.generation === generationRef.current &&
      value.flowId === flowIdRef.current
    );
  }

  function restoreCanceledIntent(
    expectedKind: "approval_intent" | "fill_intent",
    plan: ProtectionPurchasePlanSummary,
    approvalHash: `0x${string}` | null,
  ): void {
    const stored = readProtectionPurchaseRecovery();
    if (
      stored?.kind !== expectedKind ||
      stored.flowId !== flowIdRef.current ||
      stored.generation !== generationRef.current
    ) {
      throw new Error("PURCHASE_RECOVERY_CHANGED");
    }
    const nextGeneration = generationRef.current + 1;
    writeProtectionPurchaseRecovery({
      ...recoveryBase(plan, approvalHash),
      generation: nextGeneration,
      kind: "ready",
    });
    generationRef.current = nextGeneration;
    approvalHashRef.current = approvalHash;
  }

  async function closeFailedSubmittedGeneration(
    expectedKind: "approval_submitted" | "fill_submitted",
    hash: `0x${string}`,
    plan: ProtectionPurchasePlanSummary,
  ): Promise<void> {
    await withBrowserPurchaseLock(async () => {
      const stored = readProtectionPurchaseRecovery();
      if (
        stored?.kind !== expectedKind ||
        stored.hash !== hash ||
        stored.flowId !== flowIdRef.current ||
        stored.generation !== generationRef.current
      ) {
        throw new Error("PURCHASE_RECOVERY_CHANGED");
      }
      const nextGeneration = generationRef.current + 1;
      writeProtectionPurchaseRecovery({
        ...recoveryBase(plan, null),
        generation: nextGeneration,
        kind: "ready",
      });
      generationRef.current = nextGeneration;
      approvalHashRef.current = null;
    });
  }

  function provider(): Eip1193Provider {
    const resolved = suppliedProvider === undefined ? getInjectedEip1193Provider() : suppliedProvider;
    if (!resolved) {
      throw new ProtectionWalletError("provider_missing", "No browser wallet is available.");
    }
    return resolved;
  }

  async function requestPlan(account: string): Promise<ProtectionPurchasePlanResponse> {
    const response = await fetcher(PLAN_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, premiumBudgetUsd, account, offerFingerprint }),
    });
    if (!response.ok) throw new Error("plan unavailable");
    return ProtectionPurchasePlanResponseSchema.parse(await response.json());
  }

  function applyPlan(result: ProtectionPurchasePlanResponse, account: string, approvalHash: `0x${string}` | null) {
    if (result.kind === "ready_approval") {
      setPhase({ kind: "approval_ready", account, plan: result.plan, transaction: result.transaction });
      return;
    }
    if (result.kind === "ready_fill") {
      approvalHashRef.current = approvalHash;
      setPhase({ kind: "fill_ready", account, plan: result.plan, transaction: result.transaction, approvalHash });
      return;
    }
    if (result.kind === "changed") {
      setPhase({ kind: "wallet", message: "The offer changed. Review the latest terms before continuing." });
      return;
    }
    if (result.kind === "no_match") {
      setPhase({ kind: "wallet", message: "This protection is no longer available. Adjust your goal to look again." });
      return;
    }
    setPhase({ kind: "wallet", message: "Protection could not be prepared right now. Try again." });
  }

  async function completeConfirmedApproval(hash: `0x${string}`, account: string): Promise<void> {
    const fresh = await requestPlan(account);
    if (fresh.kind === "ready_fill") {
      await withBrowserPurchaseLock(async () => {
        const stored = readProtectionPurchaseRecovery();
        if (stored?.kind !== "approval_submitted" || stored.hash !== hash || stored.flowId !== flowIdRef.current) {
          throw new Error("PURCHASE_RECOVERY_CHANGED");
        }
        writeProtectionPurchaseRecovery({ ...recoveryBase(fresh.plan, hash), kind: "ready" });
      });
    }
    applyPlan(fresh, account, hash);
  }

  async function clearRevertedApproval(
    hash: `0x${string}`,
    plan: ProtectionPurchasePlanSummary,
  ): Promise<boolean> {
    try {
      await closeFailedSubmittedGeneration("approval_submitted", hash, plan);
      setPhase({ kind: "wallet", message: "The approval failed on Base. You can safely try again." });
      return true;
    } catch {
      return false;
    }
  }

  async function connectAndPrepare() {
    setPhase({ kind: "preparing" });
    try {
      const account = await connectBaseWallet(provider());
      applyPlan(await requestPlan(account), account, approvalHashRef.current);
    } catch (error) {
      setPhase({ kind: "wallet", message: walletMessage(error) });
    }
  }

  async function approve(current: Extract<ActionPhase, { kind: "approval_ready" }>) {
    try {
      const activeProvider = provider();
      const hash = await withBrowserPurchaseLock(async () => {
        if (!ownsRecovery(readProtectionPurchaseRecovery())) throw new Error("PURCHASE_ALREADY_IN_PROGRESS");
        const intent: ProtectionPurchaseRecovery = {
          ...recoveryBase(current.plan, null),
          kind: "approval_intent",
          transaction: current.transaction,
        };
        let submittedHash: `0x${string}`;
        try {
          submittedHash = await sendPreparedTransaction(
            activeProvider,
            current.transaction,
            current.account,
            async () => {
              validatePreparedProtectionTransaction("approval", current.transaction, current.plan);
              writeProtectionPurchaseRecovery(intent);
            },
          );
        } catch (error) {
          if (error instanceof ProtectionWalletError && error.code === "rejected") {
            const stored = readProtectionPurchaseRecovery();
            if (stored?.kind === "approval_intent") {
              restoreCanceledIntent("approval_intent", current.plan, null);
            }
          }
          throw error;
        }
        writeProtectionPurchaseRecovery({
          ...recoveryBase(current.plan, null),
          kind: "approval_submitted",
          transaction: current.transaction,
          hash: submittedHash,
        });
        return submittedHash;
      });
      setPhase({ kind: "approval_pending", hash, account: current.account, plan: current.plan });
      const receipt = await waitForWalletTransaction(activeProvider, hash);
      if (!receipt) return;
      await completeConfirmedApproval(hash, current.account);
    } catch (error) {
      if (error instanceof ProtectionWalletError && error.code === "reverted") {
        const failedApproval = readProtectionPurchaseRecovery();
        if (failedApproval?.kind === "approval_submitted" && await clearRevertedApproval(failedApproval.hash, current.plan)) {
          return;
        }
      }
      const stored = readProtectionPurchaseRecovery();
      if (stored?.kind === "approval_submitted") {
        setPhase({ kind: "approval_pending", hash: stored.hash, account: stored.plan.account, plan: stored.plan });
      } else if (stored?.kind === "approval_intent") {
        setPhase({
          kind: "needs_review",
          hash: null,
          message: "The approval may have been submitted, but its transaction reference was not saved. Check your wallet activity before retrying.",
        });
      } else {
        setPhase({ ...current, message: walletMessage(error) });
      }
    }
  }

  async function resumeApproval(current: Extract<ActionPhase, { kind: "approval_pending" }>) {
    try {
      const receipt = await waitForWalletTransaction(provider(), current.hash, { attempts: 1, delayMs: 0 });
      if (!receipt) return;
      await completeConfirmedApproval(current.hash, current.account);
    } catch (error) {
      if (error instanceof ProtectionWalletError && error.code === "reverted") {
        if (await clearRevertedApproval(current.hash, current.plan)) return;
      }
      setPhase({ ...current, message: walletMessage(error) });
    }
  }

  async function verify(
    hash: `0x${string}`,
    plan: ProtectionPurchasePlanSummary,
    approvalHash: `0x${string}` | null,
  ) {
    setPhase({ kind: "submitted", hash, plan, approvalHash, checking: true });
    try {
      const response = await fetcher(VERIFY_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: hash, plan }),
      });
      if (!response.ok) throw new Error("verification unavailable");
      const result = ProtectionPurchaseVerifyResponseSchema.parse(await response.json());
      if (result.kind === "verified") {
        const receipt = buildProtectionPurchaseReceipt({ plan, purchase: result, approvalTxHash: approvalHash });
        const payload = encodeProtectionPurchaseReceiptPayload(receipt);
        try {
          // Device-local convenience only — never change verified success UI or throw.
          recordActivity(protectionPurchaseActivityItem(receipt, payload));
        } catch {
          // Storage failure never alters the verified purchase outcome.
        }
        await withBrowserPurchaseLock(async () => {
          const stored = readProtectionPurchaseRecovery();
          if (
            !stored ||
            (stored.kind !== "fill_submitted" && stored.kind !== "verified") ||
            stored.hash !== hash ||
            stored.flowId !== flowIdRef.current ||
            stored.generation !== generationRef.current
          ) throw new Error("PURCHASE_RECOVERY_CHANGED");
          writeProtectionPurchaseRecovery({
            ...recoveryBase(plan, approvalHash),
            kind: "verified",
            transaction: stored.transaction,
            hash,
          });
        });
        setPhase({
          kind: "active",
          receipt,
          href: `/proof?${PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM}=${payload}`,
        });
      } else if (result.kind === "rejected" && result.reason === "failed_transaction") {
        await closeFailedSubmittedGeneration("fill_submitted", hash, plan);
        setPhase({ kind: "wallet", message: "The transaction failed on Base. You can safely try again." });
      } else if (result.kind === "rejected") {
        setPhase({ kind: "needs_review", hash, message: "The purchase evidence did not match the terms you approved." });
      } else {
        setPhase({
          kind: "submitted",
          hash,
          plan,
          approvalHash,
          checking: false,
          message:
            result.kind === "pending"
              ? "The purchase was submitted but is not confirmed yet."
              : "The purchase was submitted, but its current status is unavailable.",
        });
      }
    } catch {
      setPhase({
        kind: "submitted",
        hash,
        plan,
        approvalHash,
        checking: false,
        message: "The purchase was submitted, but its current status is unavailable.",
      });
    }
  }

  async function fill(current: Extract<ActionPhase, { kind: "fill_ready" }>) {
    setPhase({ kind: "filling" });
    try {
      const fresh = await requestPlan(current.account);
      if (
        fresh.kind !== "ready_fill" ||
        !samePurchaseTerms(current.plan, fresh.plan) ||
        Date.parse(fresh.plan.validUntil) <= Date.now()
      ) {
        setPhase({ kind: "wallet", message: "The offer changed. Review the latest terms before continuing." });
        return;
      }
      const locked = await withBrowserPurchaseLock(async () => {
        if (!ownsRecovery(readProtectionPurchaseRecovery())) throw new Error("PURCHASE_ALREADY_IN_PROGRESS");
        const intent: ProtectionPurchaseRecovery = {
          ...recoveryBase(fresh.plan, current.approvalHash),
          kind: "fill_intent",
          transaction: fresh.transaction,
        };
        let hash: `0x${string}`;
        try {
          hash = await sendPreparedTransaction(
            provider(),
            fresh.transaction,
            current.account,
            async () => {
              if (Date.parse(fresh.plan.validUntil) <= Date.now()) {
                throw new ProtectionWalletError("failed", "The prepared protection quote expired.");
              }
              validatePreparedProtectionTransaction("fill", fresh.transaction, fresh.plan);
              writeProtectionPurchaseRecovery(intent);
            },
          );
        } catch (error) {
          if (error instanceof ProtectionWalletError && error.code === "rejected") {
            const stored = readProtectionPurchaseRecovery();
            if (stored?.kind === "fill_intent") {
              restoreCanceledIntent("fill_intent", fresh.plan, current.approvalHash);
            }
          }
          throw error;
        }
        const submitted: ProtectionPurchaseRecovery = {
          ...recoveryBase(fresh.plan, current.approvalHash),
          kind: "fill_submitted",
          transaction: fresh.transaction,
          hash,
        };
        writeProtectionPurchaseRecovery(submitted);
        return submitted;
      });
      await verify(locked.hash, locked.plan, locked.approvalHash);
    } catch (error) {
      const locked = readProtectionPurchaseRecovery();
      if (locked?.kind === "fill_submitted" || locked?.kind === "verified") {
        setPhase({
          kind: "submitted",
          hash: locked.hash,
          plan: locked.plan,
          approvalHash: locked.approvalHash,
          checking: false,
          message: "This purchase was already submitted. Check its current status.",
        });
      } else if (locked?.kind === "fill_intent") {
        setPhase({
          kind: "needs_review",
          hash: null,
          message: "The purchase may have been submitted, but its transaction reference was not saved. Check your wallet activity before retrying.",
        });
      } else {
        setPhase({ ...current, message: walletMessage(error) });
      }
    }
  }

  async function startNewPurchase() {
    try {
      await withBrowserPurchaseLock(async () => {
        const stored = readProtectionPurchaseRecovery();
        if (
          stored?.kind !== "verified" ||
          stored.flowId !== flowIdRef.current ||
          stored.generation !== generationRef.current
        ) throw new Error("PURCHASE_RECOVERY_CHANGED");
        generationRef.current += 1;
        approvalHashRef.current = null;
        writeProtectionPurchaseRecovery({ ...recoveryBase(stored.plan, null), kind: "ready" });
      });
      setPhase({ kind: "wallet", message: "Ready to review a new protection purchase." });
    } catch {
      setPhase({
        kind: "needs_review",
        hash: null,
        message: "A new purchase could not be opened safely. Check this purchase again first.",
      });
    }
  }

  if (phase.kind === "active") {
    return (
      <div className="space-y-3">
        <ProtectionPurchaseReceipt receipt={phase.receipt} receiptHref={phase.href} />
        <button type="button" onClick={() => void startNewPurchase()} className="cv-btn-ghost inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold">
          Start a new purchase
        </button>
      </div>
    );
  }

  return (
    <section
      data-testid="protection-wallet-action"
      className="cv-money-sheet cv-preview-in flex min-h-[28rem] min-w-0 flex-col justify-between overflow-hidden rounded-2xl px-6 py-6 md:px-8 md:py-8 lg:min-h-[36rem]"
    >
      <div>
        <p className="text-[13px] font-medium text-neutral-500">Base wallet</p>
        <h2 className="mt-3 max-w-[16ch] text-[34px] font-semibold leading-[1.02] tracking-[-0.04em] text-black md:text-[40px]">
          {phase.kind === "wallet"
            ? "Connect to continue."
            : phase.kind === "approval_ready"
              ? "Set your spending limit."
              : phase.kind === "approval_pending"
                ? "Checking your approval."
                : phase.kind === "fill_ready"
                  ? "Ready for final approval."
                  : phase.kind === "submitted"
                    ? "Purchase submitted."
                    : phase.kind === "needs_review"
                      ? "Purchase needs review."
                      : "Preparing protection."}
        </h2>
        <p className="mt-4 max-w-[38ch] text-[16px] leading-7 text-neutral-600">
          {phase.kind === "approval_ready"
            ? "Your wallet will ask permission to use only this protection budget."
            : phase.kind === "fill_ready"
              ? "Review the final wallet request to purchase the protection."
              : phase.kind === "submitted"
                ? "Convey will only check this transaction. It will not submit another purchase."
                : phase.kind === "needs_review"
                  ? phase.message
                  : "Use the wallet holding the USDC you want to spend. Nothing moves without your approval."}
        </p>
        {"message" in phase && phase.message ? <PlanError message={phase.message} /> : null}
      </div>

      <div className="mt-8 space-y-3">
        {phase.kind === "wallet" ? (
          <button type="button" onClick={() => void connectAndPrepare()} className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
            <Wallet size="17" variant="Bold" aria-hidden="true" />
            Connect Base wallet
          </button>
        ) : phase.kind === "approval_ready" ? (
          <button type="button" onClick={() => void approve(phase)} className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold">
            Allow up to ${(Number(phase.plan.allowanceAmountMicro) / 1_000_000).toFixed(2)} USDC
          </button>
        ) : phase.kind === "approval_pending" ? (
          <>
            <button type="button" onClick={() => void resumeApproval(phase)} className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
              <Refresh size="16" variant="Linear" aria-hidden="true" />
              Check approval
            </button>
            <TransactionLink hash={phase.hash} />
          </>
        ) : phase.kind === "fill_ready" ? (
          <button type="button" onClick={() => void fill(phase)} className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
            <ShieldTick size="17" variant="Bold" aria-hidden="true" />
            Confirm protection
          </button>
        ) : phase.kind === "submitted" ? (
          <>
            <button
              type="button"
              onClick={() => void verify(phase.hash, phase.plan, phase.approvalHash)}
              disabled={phase.checking}
              aria-busy={phase.checking}
              className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:bg-neutral-300"
            >
              <Refresh size="16" variant="Linear" className="motion-safe:animate-spin" aria-hidden="true" />
              {phase.checking ? "Checking purchase…" : "Check again"}
            </button>
            <TransactionLink hash={phase.hash} />
          </>
        ) : phase.kind === "needs_review" ? (
          phase.hash ? <TransactionLink hash={phase.hash} /> : null
        ) : (
          <div className="flex min-h-12 items-center justify-center gap-2 text-sm font-semibold text-neutral-600" aria-live="polite" aria-busy="true">
            <Refresh size="17" variant="Linear" className="motion-safe:animate-spin" aria-hidden="true" />
            {phase.kind === "filling" ? "Waiting for wallet…" : "Preparing…"}
          </div>
        )}

        {phase.kind === "wallet" && recovery === null && (
          <button type="button" onClick={onAdjust} className="cv-btn-ghost inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold">
            Adjust goal
          </button>
        )}
      </div>
    </section>
  );
}

function TransactionLink({ hash }: { hash: string }) {
  return (
    <a
      href={buildBaseScanTransactionUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="cv-btn-ghost inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold"
    >
      View transaction
      <ExportSquare size="16" variant="Linear" aria-hidden="true" />
    </a>
  );
}
