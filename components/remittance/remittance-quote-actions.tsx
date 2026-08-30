import type { ReactNode } from "react";
import Link from "next/link";
import { Edit2, Refresh } from "@/components/icons";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { formatMyr, type QuoteEnvelope } from "@/lib/remittance/quote";
import { titleCaseCity } from "@/lib/remittance/quote-form";
import type { QuoteBlocker } from "@/lib/remittance/transfer";

export type { QuoteBlocker } from "@/lib/remittance/transfer";

interface RemittanceQuoteActionsProps {
  quote: QuoteEnvelope;
  expired: boolean;
  blocker: QuoteBlocker;
  confirmLabel?: string;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  handoffEligible: boolean;
  onCarry: () => void;
  editable: boolean;
}

function buildEthHedgeHref(quote: QuoteEnvelope): string {
  const params = new URLSearchParams({
    source: "remittance",
    amountMyr: formatMyr(quote.youPayMinor),
    recipient: quote.recipient,
    city: titleCaseCity(quote.destinationCity),
  });
  return `/strategy?${params.toString()}`;
}

function blockerCopy(
  blocker: Exclude<QuoteBlocker, "none">,
  recipientName: string,
): { title: string; body: string } {
  if (blocker === "wallet") return { title: "Connect wallet to continue", body: "" };
  if (blocker === "wrong-network") {
    return {
      title: "Switch wallet network",
      body: "Switch your wallet to Sui testnet to continue.",
    };
  }
  if (blocker === "unmapped") {
    return {
      title: `${recipientName} has no payout details yet`,
      body: `Add ${recipientName}'s wallet address so this transfer can continue to wallet approval.`,
    };
  }
  return {
    title: "Preview only",
    body: "This quote cannot be approved for wallet settlement.",
  };
}

function SecondaryQuoteActions({
  quote,
  onCarry,
}: {
  quote: QuoteEnvelope;
  onCarry: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 text-[11px] text-neutral-500">
      <button
        type="button"
        data-testid="carry-to-device"
        className="inline-flex min-h-9 items-center text-[11px] font-medium underline-offset-4 hover:text-neutral-800 hover:underline"
        onClick={onCarry}
      >
        Carry to another device
      </button>
      <Link
        href={buildEthHedgeHref(quote)}
        data-testid="preview-eth-hedge"
        className="inline-flex min-h-9 items-center text-[11px] font-medium underline-offset-4 hover:text-neutral-800 hover:underline"
      >
        Explore separate ETH treasury protection
      </Link>
    </div>
  );
}

function BlockerMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="remittance-preview-only"
      className="rounded-lg border border-black/8 bg-neutral-50/60 p-2.5"
    >
      <p className="text-xs font-medium text-black">{title}</p>
      {body && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-600">{body}</p>
      )}
      {children}
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      data-hit-target="true"
      className="mt-2 inline-flex h-9 w-full items-center justify-center text-[11px] font-medium text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
      onClick={onDismiss}
    >
      Dismiss
    </button>
  );
}

export function RemittanceQuoteActions({
  quote,
  expired,
  blocker,
  confirmLabel,
  onConfirm,
  onEdit,
  onDismiss,
  onRefresh,
  handoffEligible,
  onCarry,
  editable,
}: RemittanceQuoteActionsProps) {
  if (expired) {
    return (
      <div className="border-t border-black/8 p-4">
        <div
          data-testid="remittance-expired"
          className="rounded-lg border border-black/10 bg-neutral-50 p-3"
        >
          <p className="text-sm font-medium text-black">Quote expired</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            {editable
              ? "Get a fresh quote for the same details to continue."
              : "Scan a fresh quote to continue."}
          </p>
          {editable && (
            <button
              type="button"
              data-testid="refresh-quote"
              data-hit-target="true"
              className="cv-btn-solid mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
              onClick={onRefresh}
            >
              <Refresh size={15} variant="Linear" />
              Refresh quote
            </button>
          )}
        </div>
      </div>
    );
  }

  if (blocker === "none") {
    return (
      <div className="border-t border-black/8 p-4">
        <button
          type="button"
          data-testid="review-transfer"
          data-hit-target="true"
          className="cv-btn-solid inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onConfirm}
        >
          {confirmLabel ?? "Review transfer"}
        </button>
        <div className="mt-2 flex gap-2">
          {editable && (
            <button
              type="button"
              data-testid="edit-transfer"
              data-hit-target="true"
              className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
              onClick={onEdit}
            >
              <Edit2 size={15} variant="Linear" />
              Edit details
            </button>
          )}
          <button
            type="button"
            data-hit-target="true"
            className="cv-btn-ghost inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
        {handoffEligible && <SecondaryQuoteActions quote={quote} onCarry={onCarry} />}
      </div>
    );
  }

  const copy = blockerCopy(blocker, quote.recipient);
  if (blocker === "unmapped") {
    return (
      <div className="border-t border-black/8 p-4">
        <BlockerMessage {...copy} />
        {editable && (
          <button
            type="button"
            data-testid="edit-transfer"
            data-hit-target="true"
            className="cv-btn-solid mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
            onClick={onEdit}
          >
            <Edit2 size={15} variant="Linear" />
            {`Add ${quote.recipient}'s payout details`}
          </button>
        )}
        <DismissButton onDismiss={onDismiss} />
      </div>
    );
  }

  return (
    <div className="border-t border-black/8 p-4">
      <BlockerMessage {...copy}>
        {blocker === "wallet" && (
          <div className="mt-2">
            <WalletConnectButton />
          </div>
        )}
      </BlockerMessage>
      {editable && blocker === "unapproved" && (
        <button
          type="button"
          data-testid="refresh-quote"
          data-hit-target="true"
          className="cv-btn-solid mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onRefresh}
        >
          <Refresh size={15} variant="Linear" />
          Refresh quote
        </button>
      )}
      {editable && (
        <button
          type="button"
          data-testid="edit-transfer"
          data-hit-target="true"
          className="cv-btn-ghost mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          onClick={onEdit}
        >
          <Edit2 size={15} variant="Linear" />
          Edit details
        </button>
      )}
      <DismissButton onDismiss={onDismiss} />
      {handoffEligible && <SecondaryQuoteActions quote={quote} onCarry={onCarry} />}
    </div>
  );
}
