import type { StrategyResult } from "@/lib/strategy/intent";
import { StrategyPayoffMap } from "@/components/strategy/strategy-payoff-map";

interface StrategyPayoffWorkspaceProps {
  error: string | null;
  intent: StrategyResult | null;
  pending: boolean;
  refinementMessage: string | null;
}

export function StrategyPayoffWorkspace({
  error,
  intent,
  pending,
  refinementMessage,
}: StrategyPayoffWorkspaceProps) {
  return (
    <div className="cv-money-sheet cv-preview-in flex min-w-0 flex-col overflow-hidden rounded-2xl">
      <div className="px-5 pt-5 pb-3">
        <p className="font-narrow text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Payoff workspace
        </p>
        <p className="mt-1 text-sm leading-6 text-neutral-600">
          Conceptual shape of the outcome you described
        </p>
      </div>

      <div className="px-5 pb-5">
        {intent ? (
          <StrategyPayoffMap intent={intent} />
        ) : refinementMessage ? (
          <div>
            <p className="text-base font-semibold tracking-[-0.01em] text-black">
              Refine your goal
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {refinementMessage}
            </p>
          </div>
        ) : null}

        {pending && (
          <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
            Checking market context
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm leading-6 text-neutral-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
