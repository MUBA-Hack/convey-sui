import type { ReactNode } from "react";

export interface RemittanceMoneySlabProps {
  receiveLabel: ReactNode;
  sendAmount: ReactNode;
  receiveAmount: ReactNode;
  testId?: string;
  sendTestId?: string;
  receiveTestId?: string;
  className?: string;
  dataProofMode?: string;
  tone?: "primary" | "subordinate";
}

export function RemittanceMoneySlab({
  receiveLabel,
  sendAmount,
  receiveAmount,
  testId,
  sendTestId,
  receiveTestId,
  className = "",
  dataProofMode,
  tone = "primary",
}: RemittanceMoneySlabProps) {
  const primary = tone === "primary";
  const frame = primary
    ? "cv-money-tile bg-black text-white"
    : "border border-black/12 bg-neutral-50 text-black";
  const divider = primary ? "border-white/12" : "border-black/10";
  const label = primary ? "text-white/55" : "text-neutral-500";
  const value = primary ? "text-white" : "text-black";

  return (
    <div
      data-testid={testId}
      data-money-slab="dual-currency"
      data-money-tone={tone}
      data-proof-mode={dataProofMode}
      className={`grid gap-4 rounded-[18px] p-4 sm:grid-cols-2 sm:gap-0 sm:p-5 ${frame} ${className}`}
    >
      <div className={`sm:border-r sm:pr-5 ${divider}`}>
        <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${label}`}>
          You send
        </p>
        <div
          data-testid={sendTestId}
          data-money-value="true"
          className={`mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] sm:text-[30px] ${value}`}
        >
          {sendAmount}
        </div>
      </div>
      <div className={`border-t pt-3 sm:border-t-0 sm:pt-0 sm:pl-5 ${divider}`}>
        <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${label}`}>
          {receiveLabel}
        </p>
        <div
          data-testid={receiveTestId}
          data-money-value="true"
          className={`mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] sm:text-[30px] ${value}`}
        >
          {receiveAmount}
        </div>
      </div>
    </div>
  );
}
