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
}: RemittanceMoneySlabProps) {
  return (
    <div
      data-testid={testId}
      data-money-slab="dual-currency"
      data-proof-mode={dataProofMode}
      className={`cv-money-tile grid gap-4 rounded-[18px] bg-black p-4 text-white sm:grid-cols-2 sm:gap-0 sm:p-5 ${className}`}
    >
      <div className="sm:border-r sm:border-white/12 sm:pr-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
          You send
        </p>
        <div
          data-testid={sendTestId}
          data-money-value="true"
          className="mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white sm:text-[30px]"
        >
          {sendAmount}
        </div>
      </div>
      <div className="border-t border-white/12 pt-3 sm:border-t-0 sm:pt-0 sm:pl-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
          {receiveLabel}
        </p>
        <div
          data-testid={receiveTestId}
          data-money-value="true"
          className="mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-white sm:text-[30px]"
        >
          {receiveAmount}
        </div>
      </div>
    </div>
  );
}
