/**
 * Server-only bounded in-memory rate + concurrency gate.
 *
 * A shared abuse-boundary primitive for typed POST routes. It bounds two
 * independent dimensions:
 *
 * - **Concurrency:** at most `maxConcurrent` in-flight admissions at once.
 *   Every `acquire()` that is not balanced by `release()` counts against the
 *   live counter. Over-cap acquire fails closed as `concurrency_limited`.
 * - **Rate:** at most `maxRequestsPerWindow` admissions inside one fixed
 *   `windowMs` window. First admission after expiry starts a new window;
 *   over-cap acquire fails closed as `rate_limited`.
 *
 * This is an in-memory bound only. It resets on cold start and is not shared
 * across instances. It is a defence-in-depth bound, not a security boundary:
 * it never authenticates, never inspects content, and never leaks the reason
 * past the typed `RateConcurrencyGateOutcome` union. Callers map the outcome
 * to their own safe response arm.
 *
 * Imports `server-only` so an accidental client import fails the build.
 */
import "server-only";

export type RateConcurrencyGateOutcome =
  | "accepted"
  | "rate_limited"
  | "concurrency_limited";

export interface RateConcurrencyGateOptions {
  /** Maximum simultaneously admitted (unreleased) acquires. Must be >= 1. */
  readonly maxConcurrent: number;
  /** Maximum admissions inside one rolling window. Must be >= 1. */
  readonly maxRequestsPerWindow: number;
  /** Window length in milliseconds. Must be >= 1. */
  readonly windowMs: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly nowMs?: () => number;
}

export interface RateConcurrencyGate {
  /** Attempt one admission. Never throws. */
  acquire(): RateConcurrencyGateOutcome;
  /** Release one previously admitted acquire. Never throws. */
  release(): void;
  /** Reset live counters and the rate window. Test-only. */
  reset(): void;
}

interface GateState {
  inFlight: number;
  windowStart: number;
  countInWindow: number;
}

export function createRateConcurrencyGate(
  options: RateConcurrencyGateOptions,
): RateConcurrencyGate {
  if (!Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
    throw new RangeError("maxConcurrent must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(options.maxRequestsPerWindow) || options.maxRequestsPerWindow < 1) {
    throw new RangeError("maxRequestsPerWindow must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
    throw new RangeError("windowMs must be a positive safe integer.");
  }
  const nowMs = options.nowMs ?? Date.now;
  const state: GateState = {
    inFlight: 0,
    windowStart: nowMs(),
    countInWindow: 0,
  };

  return {
    acquire(): RateConcurrencyGateOutcome {
      const t = nowMs();
      if (t - state.windowStart >= options.windowMs) {
        state.windowStart = t;
        state.countInWindow = 0;
      }
      if (state.countInWindow >= options.maxRequestsPerWindow) {
        return "rate_limited";
      }
      if (state.inFlight >= options.maxConcurrent) {
        return "concurrency_limited";
      }
      state.inFlight += 1;
      state.countInWindow += 1;
      return "accepted";
    },
    release(): void {
      if (state.inFlight > 0) state.inFlight -= 1;
    },
    reset(): void {
      state.inFlight = 0;
      state.windowStart = nowMs();
      state.countInWindow = 0;
    },
  };
}
