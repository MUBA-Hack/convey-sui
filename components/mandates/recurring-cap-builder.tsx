"use client";

import { useRef, useState } from "react";
import type { Transaction } from "@mysten/sui/transactions";
import {
  useCurrentAccount,
  useCurrentNetwork,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import {
  buildRecurringCapCreation,
  validateRecurringCapDraft,
  type RecurringCapDraft,
  type RecurringCapDraftField,
  type RecurringCapDraftInput,
  type RecurringCapMetadata,
} from "@/lib/remittance/recurring-cap-draft";
import { PROTECTED_TRANSFER_REFERENCE } from "@/lib/remittance/protected-transfer-reference";
import {
  buildExplorerUrl,
  extractSuccessfulDigest,
  isTypedWalletRejection,
} from "@/lib/remittance/transfer";
import { formatUsdcGrouped } from "@/lib/remittance/money";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { InfoCircle, Lock, TickCircle } from "@/components/icons";

type PreparePhase =
  | { kind: "idle" }
  | { kind: "ready"; transaction: Transaction; metadata: RecurringCapMetadata }
  | { kind: "confirming" }
  | { kind: "submitted"; digest: string }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

const EMPTY_DRAFT: RecurringCapDraftInput = {
  beneficiaryAddress: "",
  purpose: "",
  fundedUsdc: "",
  perPaymentUsdc: "",
  totalCapUsdc: "",
  intervalDays: "30",
  expiryDate: "",
};

function formatUtcDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

function FieldMessage({ error, field }: { error?: string; field: string }) {
  if (!error) return null;
  return (
    <p data-testid={`field-error-${field}`} className="mt-1 text-[11px] font-medium text-[#a73636]">
      {error}
    </p>
  );
}

export function RecurringCapBuilder() {
  const account = useCurrentAccount();
  const network = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const packageId = PROTECTED_TRANSFER_REFERENCE.packageId;

  const [draft, setDraft] = useState<RecurringCapDraftInput>(EMPTY_DRAFT);
  const [validated, setValidated] = useState<RecurringCapDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<RecurringCapDraftField, string>>
  >({});
  const [phase, setPhase] = useState<PreparePhase>({ kind: "idle" });
  const lockRef = useRef(false);

  const connected = Boolean(account?.address);
  const onTestnet = network === "testnet";
  const blockers: string[] = [];
  if (!connected) {
    blockers.push("Connect a Sui testnet wallet to approve this mandate.");
  } else if (!onTestnet) {
    blockers.push("Switch your wallet to the Sui testnet network.");
  }

  function set(field: keyof RecurringCapDraftInput, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function review() {
    const result = validateRecurringCapDraft(draft, {
      nowMs: Date.now(),
      ownerAddress: account?.address ?? null,
    });
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setValidated(null);
      return;
    }
    setFieldErrors({});
    setValidated(result.draft);
    setPhase({ kind: "idle" });
  }

  function revise() {
    if (phase.kind === "unknown") return;
    lockRef.current = false;
    setPhase({ kind: "idle" });
    setValidated(null);
  }

  function prepare() {
    if (blockers.length > 0 || !account?.address || !validated) return;
    if (lockRef.current) return;
    // Re-validate at approval time: the expiry boundary is time-sensitive, so
    // terms validated moments ago can still fail closed here.
    const fresh = validateRecurringCapDraft(draft, {
      nowMs: Date.now(),
      ownerAddress: account.address,
    });
    if (!fresh.ok) {
      setFieldErrors(fresh.fieldErrors);
      setValidated(null);
      return;
    }
    lockRef.current = true;
    try {
      const built = buildRecurringCapCreation({
        packageId,
        sender: account.address,
        draft,
        nowMs: Date.now(),
      });
      setPhase({ kind: "ready", transaction: built.transaction, metadata: built.metadata });
    } catch (error) {
      lockRef.current = false;
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "These terms could not be prepared. Revise the mandate and try again.",
      });
    }
  }

  async function approve() {
    if (phase.kind !== "ready") return;
    const { transaction, metadata } = phase;
    setPhase({ kind: "confirming" });
    try {
      const result = await dAppKit.signAndExecuteTransaction({ transaction });
      const digest = extractSuccessfulDigest(result);
      if (!digest) {
        setPhase({ kind: "unknown" });
        return;
      }
      setPhase({ kind: "submitted", digest });
    } catch (error) {
      if (isTypedWalletRejection(error)) {
        lockRef.current = false;
        setPhase({ kind: "ready", transaction, metadata });
        return;
      }
      setPhase({ kind: "unknown" });
    }
  }

  const inputClass =
    "mt-2 min-h-12 w-full border border-black/12 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black";
  const buttonClass =
    "inline-flex min-h-12 items-center justify-center border px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

  const errorCount = Object.keys(fieldErrors).length;

  return (
    <main className="cv-shell mx-auto w-full max-w-[920px] px-4 py-8 sm:py-12">
      <header className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Mandates</p>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
          <Lock size={28} />
          Recurring spending cap
        </h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          Fund one mandate with strict limits. The beneficiary collects only within them, and
          you keep revoke and refund control at all times.
        </p>
      </header>

      {!validated ? (
        <section className="mt-8" aria-labelledby="mandate-draft-heading">
          <h2 id="mandate-draft-heading" className="text-xl font-semibold">
            Set the terms
          </h2>
          <form
            data-testid="mandate-form"
            className="mt-5 border border-black/10 bg-white p-5"
            onSubmit={(event) => {
              event.preventDefault();
              review();
            }}
            noValidate
          >
            <label className="block text-xs font-medium" htmlFor="mandate-beneficiary">
              Who collects
              <input
                id="mandate-beneficiary"
                data-testid="input-beneficiary"
                value={draft.beneficiaryAddress}
                onChange={(event) => set("beneficiaryAddress", event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} font-mono`}
                aria-invalid={fieldErrors.beneficiaryAddress ? true : undefined}
                aria-describedby={
                  fieldErrors.beneficiaryAddress ? "mandate-beneficiary-error" : undefined
                }
              />
            </label>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500">
              The wallet address that receives each collection.
            </p>
            <FieldMessage error={fieldErrors.beneficiaryAddress} field="beneficiaryAddress" />

            <label className="mt-5 block text-xs font-medium" htmlFor="mandate-purpose">
              What it pays for
              <input
                id="mandate-purpose"
                data-testid="input-purpose"
                value={draft.purpose}
                onChange={(event) => set("purpose", event.target.value)}
                maxLength={140}
                placeholder="Monthly rent support"
                className={inputClass}
                aria-invalid={fieldErrors.purpose ? true : undefined}
                aria-describedby={fieldErrors.purpose ? "mandate-purpose-error" : undefined}
              />
            </label>
            <FieldMessage error={fieldErrors.purpose} field="purpose" />

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-medium" htmlFor="mandate-funded">
                Funded amount (USDC)
                <input
                  id="mandate-funded"
                  data-testid="input-funded"
                  value={draft.fundedUsdc}
                  onChange={(event) => set("fundedUsdc", event.target.value)}
                  inputMode="decimal"
                  placeholder="100.00"
                  className={inputClass}
                  aria-invalid={fieldErrors.funded ? true : undefined}
                  aria-describedby={fieldErrors.funded ? "mandate-funded-error" : undefined}
                />
              </label>
              <label className="block text-xs font-medium" htmlFor="mandate-total">
                Lifetime cap (USDC)
                <input
                  id="mandate-total"
                  data-testid="input-total"
                  value={draft.totalCapUsdc}
                  onChange={(event) => set("totalCapUsdc", event.target.value)}
                  inputMode="decimal"
                  placeholder="100.00"
                  className={inputClass}
                  aria-invalid={fieldErrors.totalCap ? true : undefined}
                  aria-describedby={fieldErrors.totalCap ? "mandate-total-error" : undefined}
                />
              </label>
              <label className="block text-xs font-medium" htmlFor="mandate-per-payment">
                Maximum each collection (USDC)
                <input
                  id="mandate-per-payment"
                  data-testid="input-per-payment"
                  value={draft.perPaymentUsdc}
                  onChange={(event) => set("perPaymentUsdc", event.target.value)}
                  inputMode="decimal"
                  placeholder="10.00"
                  className={inputClass}
                  aria-invalid={fieldErrors.perPayment ? true : undefined}
                  aria-describedby={
                    fieldErrors.perPayment ? "mandate-per-payment-error" : undefined
                  }
                />
              </label>
              <label className="block text-xs font-medium" htmlFor="mandate-interval">
                Minimum days between collections
                <input
                  id="mandate-interval"
                  data-testid="input-interval"
                  value={draft.intervalDays}
                  onChange={(event) => set("intervalDays", event.target.value)}
                  inputMode="numeric"
                  placeholder="30"
                  className={inputClass}
                  aria-invalid={fieldErrors.interval ? true : undefined}
                  aria-describedby={fieldErrors.interval ? "mandate-interval-error" : undefined}
                />
              </label>
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FieldMessage error={fieldErrors.funded} field="funded" />
              <FieldMessage error={fieldErrors.totalCap} field="totalCap" />
              <FieldMessage error={fieldErrors.perPayment} field="perPayment" />
              <FieldMessage error={fieldErrors.interval} field="interval" />
            </div>

            <label className="mt-5 block text-xs font-medium" htmlFor="mandate-expiry">
              Expires on
              <input
                id="mandate-expiry"
                data-testid="input-expiry"
                type="date"
                value={draft.expiryDate}
                onChange={(event) => set("expiryDate", event.target.value)}
                className={inputClass}
                aria-invalid={fieldErrors.expiry ? true : undefined}
                aria-describedby={fieldErrors.expiry ? "mandate-expiry-error" : undefined}
              />
            </label>
            <FieldMessage error={fieldErrors.expiry} field="expiry" />

            {errorCount > 0 ? (
              <p role="alert" className="mt-4 text-[11px] font-medium text-[#a73636]">
                Fix the highlighted fields to continue.
              </p>
            ) : null}

            <button
              type="submit"
              className={`${buttonClass} mt-5 w-full border-black bg-black text-white sm:w-auto`}
            >
              Review limits
            </button>
          </form>
          <p className="mt-4 max-w-xl text-[11px] leading-4 text-neutral-500">
            A mandate pays up to your per-collection maximum, never more than the lifetime cap,
            no sooner than the interval you set, and never after expiry. Revoke any time and the
            unspent balance returns to you.
          </p>
        </section>
      ) : (
        <section className="mt-8" aria-labelledby="mandate-review-heading">
          <h2 id="mandate-review-heading" className="text-xl font-semibold">
            Review the exact limits
          </h2>
          <dl
            data-testid="review-limits"
            className="mt-5 divide-y divide-black/8 border border-black/10 bg-white"
          >
            {[
              ["Maximum each collection", `${formatUsdcGrouped(validated.perPaymentCapMicro)} USDC`, "payoff-per-payment"],
              ["Maximum lifetime spend", `${formatUsdcGrouped(validated.totalCapMicro)} USDC`, "payoff-total-cap"],
              ["Amount the mandate holds", `${formatUsdcGrouped(validated.fundedMicro)} USDC`, "payoff-funded"],
              ["First collection", "Any time after the mandate is created", "payoff-first-collection"],
              ["Then, at least", `${validated.intervalDays} days between collections`, "payoff-interval"],
              ["Automatic expiry", `${formatUtcDate(validated.expiryMs)}, end of day UTC`, "payoff-expiry"],
              ["Unspent refund", "Revoke any time and the unspent balance returns to you", "payoff-refund"],
            ].map(([label, value, testId]) => (
              <div
                key={testId}
                className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between"
              >
                <dt className="text-xs font-medium text-neutral-500">{label}</dt>
                <dd data-testid={testId} className="text-sm font-medium">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] leading-4 text-neutral-500">
            The amount moves out of your wallet only when you approve the transaction. Until
            then nothing is funded and nothing is on chain.
          </p>

          {blockers.length > 0 ? (
            <div
              data-testid="ready-for-wallet-review"
              className="mt-5 border border-black/10 bg-white p-5"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <TickCircle size={18} />
                Terms validated. Ready for wallet review.
              </p>
              <ul data-testid="ready-blockers" className="mt-3 space-y-2">
                {blockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="flex items-start gap-2 text-[13px] leading-5 text-neutral-600"
                  >
                    <InfoCircle size={16} />
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
              {!connected ? (
                <div className="mt-4">
                  <WalletConnectButton />
                </div>
              ) : null}
            </div>
          ) : null}

          {phase.kind === "ready" ? (
            <div
              data-testid="prepared-panel"
              className="mt-5 border border-black/10 bg-white p-5"
            >
              <p className="text-sm font-medium">Prepared for wallet review</p>
              <p className="mt-2 text-[13px] leading-5 text-neutral-600">
                Your wallet will show one transaction: create the mandate with
                {" "}
                {formatUsdcGrouped(phase.metadata.fundedMicro)} USDC, a
                {" "}
                {formatUsdcGrouped(phase.metadata.perPaymentCapMicro)} USDC per-collection
                maximum, a {formatUsdcGrouped(phase.metadata.totalCapMicro)} USDC lifetime cap,
                and expiry on {formatUtcDate(phase.metadata.expiryMs)}.
              </p>
              <button
                type="button"
                data-testid="approve-button"
                onClick={() => void approve()}
                className={`${buttonClass} mt-4 w-full border-black bg-black text-white sm:w-auto`}
              >
                Approve in wallet
              </button>
            </div>
          ) : null}

          {phase.kind === "confirming" ? (
            <p
              data-testid="confirming-status"
              aria-live="polite"
              className="mt-4 text-sm text-neutral-600"
            >
              Confirm in your wallet.
            </p>
          ) : null}

          {phase.kind === "submitted" ? (
            <div
              data-testid="submitted-status"
              className="mt-5 border border-black/10 bg-white p-5"
            >
              <p aria-live="polite" className="text-sm font-medium">
                Submitted. Confirmation pending.
              </p>
              <p className="mt-2 text-[13px] leading-5 text-neutral-600">
                Your wallet submitted the mandate. Convey has not independently confirmed the
                on-chain result, so no active or funded status is shown.
              </p>
              <a
                data-testid="submitted-explorer"
                href={buildExplorerUrl(phase.digest)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-black underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                View the submitted transaction
              </a>
            </div>
          ) : null}

          {phase.kind === "unknown" ? (
            <p
              data-testid="unknown-status"
              role="alert"
              aria-live="polite"
              className="mt-5 border border-black/10 bg-white p-5 text-sm text-neutral-700"
            >
              Outcome unknown. Check your wallet and the explorer before starting a new mandate.
            </p>
          ) : null}

          {phase.kind === "error" ? (
            <p
              data-testid="prepare-error"
              role="alert"
              className="mt-5 border border-black/10 bg-white p-5 text-sm text-[#a73636]"
            >
              {phase.message}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              data-testid="revise-button"
              onClick={revise}
              disabled={phase.kind === "unknown"}
              className={`${buttonClass} border-black/15 bg-white text-black`}
            >
              Revise terms
            </button>
            <button
              type="button"
              data-testid="prepare-button"
              onClick={prepare}
              disabled={
                blockers.length > 0 ||
                phase.kind === "ready" ||
                phase.kind === "confirming" ||
                phase.kind === "submitted"
              }
              className={`${buttonClass} border-black bg-black text-white`}
            >
              Prepare approval
            </button>
          </div>
          <p className="mt-4 max-w-xl text-[11px] leading-4 text-neutral-500">
            Convey checks these limits on this device before any approval. The Sui contract
            enforces the same caps, interval, and expiry on chain once the mandate is created.
          </p>
        </section>
      )}
    </main>
  );
}
