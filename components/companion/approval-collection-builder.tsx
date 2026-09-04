"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount, useCurrentNetwork, useDAppKit } from "@mysten/dapp-kit-react";
import { motion, useReducedMotion } from "motion/react";
import { Add, SecuritySafe, TickCircle, Trash, Warning2 } from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import {
  APPROVAL_COLLECTION_MAX_APPROVERS,
  APPROVAL_COLLECTION_DEADLINE_PRESETS,
  buildApprovalCollection,
  validateApprovalCollectionDraft,
  type ApprovalCollectionDeadlinePreset,
  type ApprovalCollectionDraft,
  type ApprovalCollectionField,
} from "@/lib/remittance/approval-collection-draft";
import { buildExplorerUrl, extractSuccessfulDigest, isTypedWalletRejection } from "@/lib/remittance/transfer";
import { formatUsdcGrouped } from "@/lib/remittance/money";

const PRESET_LABELS: Record<ApprovalCollectionDeadlinePreset, string> = {
  tomorrow: "Tomorrow",
  three_days: "In 3 days",
  seven_days: "In 7 days",
};

const PREPARE_BUILD_ERROR =
  "The prepared terms could not become a transaction. Review the details and try again.";

function formatExpiryUtc(deadlineMs: number): string {
  const iso = new Date(deadlineMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

type Step = "details" | "review";

type WalletPhase =
  | { kind: "idle" }
  | { kind: "prepared" }
  | { kind: "confirming" }
  | { kind: "submitted"; digest: string }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

/**
 * Organization approval-collection creation flow for the published
 * `ApprovalCollection<T>` contract family.
 *
 * Truth boundaries enforced here:
 * - Every term is validated locally and shown exactly before any wallet
 *   action. The connected wallet is the only value-moving boundary.
 * - Without a connected testnet wallet the CTA honestly says
 *   "Prepare for wallet review" and the surface stays "Prepared. Not
 *   submitted." No created, active, verified, or on-chain success state
 *   exists in this component, and no independent chain check is claimed.
 * - After the wallet returns a successful digest the surface stays at
 *   "Submitted. Confirmation pending." with an explorer link; it never
 *   upgrades to a lifecycle claim.
 */
export function ApprovalCollectionBuilder({
  organizationName,
  onClose,
}: {
  organizationName: string;
  onClose: () => void;
}) {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lockRef = useRef(false);

  const [step, setStep] = useState<Step>("details");
  const [title, setTitle] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [approvers, setApprovers] = useState<string[]>([""]);
  const [threshold, setThreshold] = useState(1);
  const [preset, setPreset] = useState<ApprovalCollectionDeadlinePreset>("three_days");
  const [errors, setErrors] = useState<Partial<Record<ApprovalCollectionField, string>>>({});
  const [phase, setPhase] = useState<WalletPhase>({ kind: "idle" });
  const [draft, setDraft] = useState<ApprovalCollectionDraft | null>(null);

  const walletReady = Boolean(account?.address) && network === "testnet";
  const busy = phase.kind === "confirming";
  const terminal = phase.kind === "submitted" || phase.kind === "unknown";
  const approverCount = approvers.length;
  const thresholdMax = Math.max(1, approverCount);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function closeIfIdle() {
    if (busy) return;
    onClose();
  }

  function continueToReview() {
    if (busy) return;
    const result = validateApprovalCollectionDraft({
      title,
      beneficiary,
      amountMajor,
      approvers,
      threshold,
      deadlinePreset: preset,
      nowMs: Date.now(),
    });
    if (!result.ok) {
      const nextErrors: Partial<Record<ApprovalCollectionField, string>> = {};
      for (const error of result.errors) {
        if (!nextErrors[error.field]) nextErrors[error.field] = error.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setDraft(result.draft);
    setStep("review");
  }

  function reviseDetails() {
    if (terminal) return;
    // A prepared state is stale once any detail can change again.
    setPhase((current) => (current.kind === "prepared" ? { kind: "idle" } : current));
    setStep("details");
  }

  function prepareForWalletReview() {
    setPhase({ kind: "prepared" });
  }

  async function approveInWallet() {
    if (!draft || !walletReady || lockRef.current) return;
    lockRef.current = true;
    setPhase({ kind: "confirming" });
    let signing = false;
    try {
      const built = buildApprovalCollection({
        draft,
        sender: account!.address,
        nowMs: Date.now(),
      });
      signing = true;
      const result = await dAppKit.signAndExecuteTransaction({
        transaction: built.transaction,
      });
      const digest = extractSuccessfulDigest(result);
      if (!digest) {
        setPhase({ kind: "unknown" });
        return;
      }
      setPhase({ kind: "submitted", digest });
    } catch (error) {
      if (!signing) {
        setPhase({ kind: "error", message: PREPARE_BUILD_ERROR });
        return;
      }
      if (isTypedWalletRejection(error)) {
        // The customer declined in the wallet. Nothing was submitted; the
        // exact prepared terms stay reviewable and can be approved again.
        setPhase({ kind: "prepared" });
        return;
      }
      setPhase({ kind: "unknown" });
    } finally {
      lockRef.current = false;
    }
  }

  const primaryCta =
    phase.kind === "confirming"
      ? "Confirm in your wallet"
      : phase.kind === "prepared"
        ? "Prepare for wallet review"
        : phase.kind === "submitted"
          ? "Submitted. Confirmation pending."
          : phase.kind === "unknown"
            ? "Outcome unknown"
            : walletReady
              ? "Approve in wallet"
              : "Prepare for wallet review";

  const errorId = (field: ApprovalCollectionField) => `approval-collection-${field}-error`;

  return (
    <div
      className="companion-message--contract-demo"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-collection-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") closeIfIdle();
      }}
    >
      <motion.section
        ref={panelRef}
        tabIndex={-1}
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
        data-testid="approval-collection-builder"
        className="max-h-[calc(100dvh-56px)] w-full max-w-[660px] overflow-y-auto rounded-[26px] border border-black/10 bg-white shadow-[0_22px_55px_rgba(0,0,0,0.08)] outline-none"
      >
        <header className="border-b border-black/8 bg-[#f6f6f3] px-5 py-6 sm:px-7">
          <div className="flex items-start justify-between gap-5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black text-white">
              <SecuritySafe size={22} />
            </span>
            <button
              type="button"
              onClick={closeIfIdle}
              disabled={busy}
              className="min-h-11 rounded-full border border-black/12 px-4 text-xs font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-40"
            >
              Close
            </button>
          </div>
          <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-black/42">
            {organizationName} controls
          </p>
          <h3
            id="approval-collection-title"
            className="mt-2 max-w-[18ch] text-[30px] font-medium leading-[1.02] tracking-[-0.045em] text-black sm:text-[34px]"
          >
            Create approval collection.
          </h3>
          <p className="mt-3 max-w-[54ch] text-sm leading-6 text-black/58">
            Fund one amount that pays out only after the required approvals.
            Convey prepares the terms; your wallet is the only approval.
          </p>
        </header>

        {step === "details" ? (
          <form
            className="grid gap-6 p-5 sm:p-7"
            onSubmit={(event) => {
              event.preventDefault();
              continueToReview();
            }}
          >
            <div>
              <label className="text-xs font-semibold text-black" htmlFor="approval-collection-purpose">
                Purpose
                <input
                  id="approval-collection-purpose"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setErrors((current) => ({ ...current, title: undefined }));
                  }}
                  maxLength={300}
                  placeholder="What is this collection for?"
                  aria-describedby={errors.title ? errorId("title") : undefined}
                  aria-invalid={Boolean(errors.title)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-black/12 bg-white px-3 text-sm font-normal text-black outline-none placeholder:text-black/35 focus:border-black"
                />
              </label>
              {errors.title && (
                <p id={errorId("title")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                  {errors.title}
                </p>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-black" htmlFor="approval-collection-beneficiary">
                  Beneficiary Sui address
                  <input
                    id="approval-collection-beneficiary"
                    value={beneficiary}
                    onChange={(event) => {
                      setBeneficiary(event.target.value);
                      setErrors((current) => ({ ...current, beneficiary: undefined }));
                    }}
                    placeholder="0x…"
                    spellCheck={false}
                    aria-describedby={errors.beneficiary ? errorId("beneficiary") : undefined}
                    aria-invalid={Boolean(errors.beneficiary)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-black/12 bg-white px-3 font-mono text-xs text-black outline-none placeholder:text-black/35 focus:border-black"
                  />
                </label>
                {errors.beneficiary && (
                  <p id={errorId("beneficiary")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                    {errors.beneficiary}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-black" htmlFor="approval-collection-amount">
                  Amount (USDC)
                  <input
                    id="approval-collection-amount"
                    value={amountMajor}
                    onChange={(event) => {
                      setAmountMajor(event.target.value);
                      setErrors((current) => ({ ...current, amount: undefined }));
                    }}
                    inputMode="decimal"
                    placeholder="500"
                    aria-describedby={errors.amount ? errorId("amount") : undefined}
                    aria-invalid={Boolean(errors.amount)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-black/12 bg-white px-3 text-sm text-black outline-none placeholder:text-black/35 focus:border-black"
                  />
                </label>
                {errors.amount && (
                  <p id={errorId("amount")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                    {errors.amount}
                  </p>
                )}
              </div>
            </div>

            <fieldset>
              <legend className="text-xs font-semibold text-black">
                Approvers
                <span className="ml-2 font-normal text-black/45">
                  Who must approve before the beneficiary is paid. Up to {APPROVAL_COLLECTION_MAX_APPROVERS}.
                </span>
              </legend>
              <div className="mt-3 grid gap-2">
                {approvers.map((value, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={value}
                      onChange={(event) => {
                        const next = [...approvers];
                        next[index] = event.target.value;
                        setApprovers(next);
                        setErrors((current) => ({ ...current, approvers: undefined }));
                      }}
                      placeholder={`Approver ${index + 1} Sui address`}
                      aria-label={`Approver ${index + 1} Sui address`}
                      spellCheck={false}
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-black/12 bg-white px-3 font-mono text-xs text-black outline-none placeholder:text-black/35 focus:border-black"
                    />
                    {approvers.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove approver ${index + 1}`}
                        onClick={() => {
                          setApprovers(approvers.filter((_, i) => i !== index));
                          setThreshold(Math.min(threshold, Math.max(1, approvers.length - 1)));
                          setErrors((current) => ({ ...current, approvers: undefined }));
                        }}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/12 text-black/55 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
                      >
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (approvers.length >= APPROVAL_COLLECTION_MAX_APPROVERS) return;
                  setApprovers([...approvers, ""]);
                  setThreshold(Math.min(threshold, Math.min(approvers.length + 1, APPROVAL_COLLECTION_MAX_APPROVERS)));
                  setErrors((current) => ({ ...current, approvers: undefined }));
                }}
                disabled={approvers.length >= APPROVAL_COLLECTION_MAX_APPROVERS}
                className="cv-btn-ghost mt-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-3 text-xs font-semibold uppercase tracking-[0.1em] disabled:opacity-40"
              >
                <Add size={15} />
                Add approver
              </button>
              {errors.approvers && (
                <p id={errorId("approvers")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                  {errors.approvers}
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className="text-xs font-semibold text-black">
                Approvals required
                <span className="ml-2 font-normal text-black/45">
                  {threshold} of {approverCount} releases the balance.
                </span>
              </legend>
              <div role="group" aria-label="Approvals required" className="mt-3 flex flex-wrap gap-2">
                {Array.from({ length: thresholdMax }, (_, i) => i + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={threshold === count}
                    aria-label={`Require ${count} of ${approverCount} approvals`}
                    onClick={() => setThreshold(count)}
                    className={`flex h-11 min-w-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                      threshold === count
                        ? "border-black bg-black text-white"
                        : "border-black/10 bg-white text-black"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              {errors.threshold && (
                <p id={errorId("threshold")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                  {errors.threshold}
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className="text-xs font-semibold text-black">
                Expiry
                <span className="ml-2 font-normal text-black/45">
                  After the expiry, the funding wallet can refund the balance.
                </span>
              </legend>
              <div role="group" aria-label="Expiry" className="mt-3 grid grid-cols-3 gap-2">
                {APPROVAL_COLLECTION_DEADLINE_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={preset === value}
                    onClick={() => {
                      setPreset(value);
                      setErrors((current) => ({ ...current, expiry: undefined }));
                    }}
                    className={`flex min-h-11 items-center justify-center rounded-xl border px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                      preset === value ? "border-black bg-black text-white" : "border-black/10 bg-white text-black"
                    }`}
                  >
                    {PRESET_LABELS[value]}
                  </button>
                ))}
              </div>
              {errors.expiry && (
                <p id={errorId("expiry")} role="alert" className="mt-2 text-xs font-medium text-[#a73636]">
                  {errors.expiry}
                </p>
              )}
            </fieldset>

            <button
              type="submit"
              className="min-h-12 rounded-xl bg-black px-5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Review collection
            </button>
          </form>
        ) : (
          <div className="grid gap-6 p-5 sm:p-7">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-black/9 bg-black/9" data-testid="approval-collection-review">
              <div className="flex items-center justify-between gap-4 bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Amount held</span>
                <span className="text-right text-sm font-semibold text-black">
                  {draft ? `${formatUsdcGrouped(draft.amountMicro)} USDC` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Asset</span>
                <span className="text-right text-sm font-semibold text-black">USDC on Sui testnet</span>
              </div>
              <div className="bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Beneficiary</span>
                <p className="mt-1 break-all font-mono text-xs leading-5 text-black">{draft?.beneficiary}</p>
              </div>
              <div className="bg-white px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Approvers</span>
                <p className="mt-1 text-sm font-semibold text-black">
                  {draft ? `${draft.threshold} of ${draft.approvers.length} approvals required` : ""}
                </p>
                <ul className="mt-2 grid gap-1.5">
                  {draft?.approvers.map((approver, index) => (
                    <li key={approver} className="break-all font-mono text-[11px] leading-4 text-black/62">
                      {index + 1}. {approver}
                    </li>
                  ))}
                </ul>
              </div>
              {draft && (
                <>
                  <div className="bg-white px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Release condition</span>
                    <p className="mt-1 text-xs leading-5 text-black/68">
                      The full balance pays the beneficiary only after {draft.threshold} of{" "}
                      {draft.approvers.length} approvers approve before the expiry. No single
                      person can move the funds alone.
                    </p>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Refund timing</span>
                    <p className="mt-1 text-xs leading-5 text-black/68">
                      If the approvals are not reached, the funding wallet can refund the full
                      balance after the expiry.
                    </p>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Expiry</span>
                    <p className="mt-1 text-xs font-semibold text-black">{formatExpiryUtc(draft.deadlineMs)}</p>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Wallet boundary</span>
                    <p className="mt-1 text-xs leading-5 text-black/68">
                      Your connected wallet signs the funding transaction. Convey never holds
                      keys, and no AI or server can approve this payment for you.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="grid gap-2" data-testid="approval-collection-wallet-zone">
              {phase.kind === "idle" && !walletReady && (
                <p className="text-xs leading-5 text-black/58">
                  Connect a Sui testnet wallet to fund this collection. Nothing is submitted
                  until your wallet approves the exact transaction.
                </p>
              )}
              {phase.kind === "prepared" && (
                <p
                  data-testid="approval-collection-prepared"
                  className="flex items-center gap-2 text-xs font-semibold text-black"
                  role="status"
                >
                  <TickCircle size={16} />
                  Prepared. Not submitted.
                </p>
              )}
              {phase.kind === "prepared" && (
                <p className="text-xs leading-5 text-black/58">
                  Review the terms above, then connect a Sui testnet wallet to continue.
                  Your wallet will show the exact transaction before it is signed.
                </p>
              )}
              {phase.kind === "confirming" && (
                <p className="sr-only" aria-live="polite">
                  Confirm in your wallet
                </p>
              )}
              {phase.kind === "submitted" && (
                <div className="grid gap-1" data-testid="approval-collection-submitted">
                  <p className="text-xs font-semibold text-black" role="status">
                    Submitted. Confirmation pending.
                  </p>
                  <a
                    href={buildExplorerUrl(phase.digest)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-[11px] font-medium text-black underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black"
                  >
                    View on Sui Explorer
                  </a>
                </div>
              )}
              {phase.kind === "unknown" && (
                <p
                  data-testid="approval-collection-unknown"
                  className="flex items-start gap-2 text-xs leading-5 text-black/68"
                  role="alert"
                >
                  <Warning2 size={16} className="mt-0.5 shrink-0" />
                  Outcome unknown. Check your wallet and the Sui explorer before trying again.
                  Nothing here claims the collection was created.
                </p>
              )}
              {phase.kind === "error" && (
                <p role="alert" className="text-xs font-medium text-[#a73636]">
                  {phase.message}
                </p>
              )}
              {!walletReady && phase.kind !== "submitted" && phase.kind !== "unknown" && (
                <WalletConnectButton />
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={reviseDetails}
                disabled={terminal || busy}
                className="cv-btn-ghost inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
              >
                Back to details
              </button>
              {walletReady ? (
                <button
                  type="button"
                  data-testid="approval-collection-approve"
                  onClick={() => void approveInWallet()}
                  disabled={busy || terminal || phase.kind === "error" || !draft}
                  className="cv-btn-solid inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
                >
                  {primaryCta}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="approval-collection-prepare"
                  onClick={prepareForWalletReview}
                  disabled={busy || terminal || phase.kind === "prepared" || !draft}
                  className="cv-btn-solid inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
                >
                  {primaryCta}
                </button>
              )}
            </div>
            <p className="text-[11px] leading-5 text-black/48">
              The collection is governed by the published approval-collection contract.
              Release or refund always happens through explicit wallet approvals, and the
              funding wallet pays gas.
            </p>
          </div>
        )}
      </motion.section>
    </div>
  );
}
