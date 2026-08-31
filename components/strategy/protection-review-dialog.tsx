"use client";

import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatProtectionExpiry,
  formatStrike,
  formatUsdcMicro,
} from "@/lib/strategy/format";

interface ProtectionReviewDialogProps {
  recommendation: Extract<ShieldRecommendation, { kind: "live" }>;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}

export function ProtectionReviewDialog({
  recommendation,
  open,
  pending = false,
  onOpenChange,
  onContinue,
}: ProtectionReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-[35rem]"
        showCloseButton={!pending}
      >
        <DialogHeader className="px-5 pb-4 pt-6 sm:px-7 sm:pt-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Review protection
          </p>
          <DialogTitle className="text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[36px]">
            A floor for your {recommendation.asset}
          </DialogTitle>
          <DialogDescription className="max-w-[42ch] text-[15px] leading-6">
            Check the exact terms before connecting a Base wallet. Your family
            transfers remain separate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-px bg-black/8">
          <ReviewFact label="Floor" value={formatStrike(recommendation.strikeUsd)} />
          <ReviewFact label="Ends" value={formatProtectionExpiry(recommendation.expiresAt)} />
          <ReviewFact
            label="Budget limit"
            value={`${formatUsdcMicro(recommendation.premiumAmountUsdc)} USDC`}
          />
          <ReviewFact label="Network" value="Base" />
        </div>

        <div className="space-y-3 px-5 py-5 text-[14px] leading-6 text-neutral-700 sm:px-7">
          <p>
            If {recommendation.asset} finishes below {formatStrike(recommendation.strikeUsd)},
            this protection can cover the difference under these terms.
          </p>
          <p>
            If it finishes at or above the floor, the protection can expire
            unused. The cost is not returned.
          </p>
          <p className="border-l-2 border-black pl-4 text-neutral-600">
            Your {recommendation.asset} stays in your wallet. Nothing is
            purchased until you approve it there.
          </p>
        </div>

        <div className="sticky bottom-0 border-t border-black/8 bg-white px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onContinue}
            disabled={pending}
            aria-busy={pending}
            className="cv-btn-solid inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {pending ? "Connecting…" : "Continue to wallet"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-5 py-4 sm:px-7">
      <p className="text-[12px] font-medium text-neutral-500">{label}</p>
      <p className="mt-1 break-words text-[18px] font-semibold tracking-[-0.025em] text-black">
        {value}
      </p>
    </div>
  );
}
