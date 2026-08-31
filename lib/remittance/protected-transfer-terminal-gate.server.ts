/**
 * Server-only shared rate + concurrency gate for the Protected Transfer
 * terminal POST routes (`/terminal/verify` and `/terminal/open`).
 *
 * Both routes share one in-memory gate so the combined load on the fixed
 * testnet RPC boundary stays bounded: at most `MAX_CONCURRENT` in-flight
 * admissions and at most `MAX_REQUESTS_PER_WINDOW` admissions per fixed
 * `WINDOW_MS` window. The gate is a defence-in-depth abuse bound only; it
 * resets on cold start, is not shared across instances, and never inspects
 * content. A denied admission maps to the safe `unavailable` response arm.
 *
 * Imports `server-only` so an accidental client import fails the build.
 */
import "server-only";

import {
  createRateConcurrencyGate,
  type RateConcurrencyGate,
  type RateConcurrencyGateOutcome,
} from "@/lib/http/rate-concurrency-gate.server";

export const PROTECTED_TRANSFER_TERMINAL_GATE_MAX_CONCURRENT = 4;
export const PROTECTED_TRANSFER_TERMINAL_GATE_MAX_REQUESTS_PER_WINDOW = 20;
export const PROTECTED_TRANSFER_TERMINAL_GATE_WINDOW_MS = 10_000;

export type ProtectedTransferTerminalGateOutcome = RateConcurrencyGateOutcome;

let current: RateConcurrencyGate = createRateConcurrencyGate({
  maxConcurrent: PROTECTED_TRANSFER_TERMINAL_GATE_MAX_CONCURRENT,
  maxRequestsPerWindow: PROTECTED_TRANSFER_TERMINAL_GATE_MAX_REQUESTS_PER_WINDOW,
  windowMs: PROTECTED_TRANSFER_TERMINAL_GATE_WINDOW_MS,
});

/**
 * Acquire one admission from the shared gate. Returns `"accepted"` or a
 * denied outcome. Every `"accepted"` MUST be balanced by a `release` call in
 * a `finally` block.
 */
export function acquireProtectedTransferTerminalGate(): ProtectedTransferTerminalGateOutcome {
  return current.acquire();
}

/** Release one previously admitted acquire. Never throws. */
export function releaseProtectedTransferTerminalGate(): void {
  current.release();
}

/**
 * Test-only: replace the shared gate with a deterministic instance and return
 * a handle that restores the default. Pass `null` to restore immediately.
 */
export function __setProtectedTransferTerminalGateForTest(
  gate: RateConcurrencyGate | null,
): void {
  if (gate === null) {
    current = createRateConcurrencyGate({
      maxConcurrent: PROTECTED_TRANSFER_TERMINAL_GATE_MAX_CONCURRENT,
      maxRequestsPerWindow: PROTECTED_TRANSFER_TERMINAL_GATE_MAX_REQUESTS_PER_WINDOW,
      windowMs: PROTECTED_TRANSFER_TERMINAL_GATE_WINDOW_MS,
    });
    return;
  }
  current = gate;
}
