import "server-only";

import {
  createRateConcurrencyGate,
  type RateConcurrencyGate,
  type RateConcurrencyGateOutcome,
} from "@/lib/http/rate-concurrency-gate.server";

export const STRATEGY_BASE_GATE_MAX_CONCURRENT = 4;
export const STRATEGY_BASE_GATE_MAX_REQUESTS_PER_WINDOW = 20;
export const STRATEGY_BASE_GATE_WINDOW_MS = 10_000;

function createDefaultGate(): RateConcurrencyGate {
  return createRateConcurrencyGate({
    maxConcurrent: STRATEGY_BASE_GATE_MAX_CONCURRENT,
    maxRequestsPerWindow: STRATEGY_BASE_GATE_MAX_REQUESTS_PER_WINDOW,
    windowMs: STRATEGY_BASE_GATE_WINDOW_MS,
  });
}

let current = createDefaultGate();

export function acquireStrategyBaseGate(): RateConcurrencyGateOutcome {
  return current.acquire();
}

export function releaseStrategyBaseGate(): void {
  current.release();
}

export function __setStrategyBaseGateForTest(gate: RateConcurrencyGate | null): void {
  current = gate ?? createDefaultGate();
}
