import type { StrategyResult } from "@/lib/strategy/intent";
import { StrategyPayoffMap } from "@/components/strategy/strategy-payoff-map";

interface StrategyPayoffWorkspaceProps {
  error: string | null;
  intent: StrategyResult | null;
  reserveScenarioUsdc: number;
  pending: boolean;
  refinementMessage: string | null;
}

export function StrategyPayoffWorkspace({
  error,
  intent,
  reserveScenarioUsdc,
  pending,
  refinementMessage,
}: StrategyPayoffWorkspaceProps) {
  return (
    <div className="cv-money-sheet flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl lg:min-h-[36rem]">
      <div className="px-6 pt-6 pb-4 md:px-8 md:pt-8">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-neutral-500">
          Payoff workspace
        </p>
        <p className="mt-2 text-[17px] leading-7 text-neutral-600">
          {pending
            ? "Checking live protection terms"
            : "Conceptual shape of the outcome you described"}
        </p>
      </div>

      <div className="relative flex flex-1 flex-col px-6 pb-6 md:px-8 md:pb-8">
        {pending && (
          <div
            data-testid="treasury-loading"
            className="cv-shimmer mb-4 h-1.5 w-24 rounded-full bg-neutral-200"
            aria-live="polite"
          />
        )}

        {intent ? (
          <>
            <StrategyPayoffMap intent={intent} />
            {intent.objective !== "protect_downside" && (
              <p className="mt-auto border-t border-black/8 pt-4 text-[12px] leading-5 text-neutral-500">
                Scenario: {reserveScenarioUsdc.toLocaleString()} USDC. This shapes the goal only; a fresh order and exact wallet approval are still required.
              </p>
            )}
          </>
        ) : refinementMessage ? (
          <div>
            <p className="text-[28px] font-semibold tracking-[-0.04em] text-black">
              Refine your goal
            </p>
            <p className="mt-3 max-w-[38ch] text-[17px] leading-7 text-neutral-600">
              {refinementMessage}
            </p>
          </div>
        ) : null}

        {error && (
          <p role="alert" className="mt-4 text-[15px] leading-6 text-neutral-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
