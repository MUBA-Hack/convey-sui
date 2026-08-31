/**
 * Server-only Protected Transfer configuration resolver.
 *
 * Resolves server-authored Protected Transfer trust roots: a configured package
 * object ID, canonical reviewer address, and bounded reviewer display name.
 * The plan endpoint never accepts them from a client request. The package ID is
 * a configured candidate only; this resolver does not verify deployment until
 * an independent event verifier observes an exact event from that package.
 *
 * Imports `server-only` so any accidental client import fails the build. It
 * never reads a `NEXT_PUBLIC_` variable, never adds defaults or placeholders,
 * never makes an RPC call, and never claims the package exists, is deployed, or
 * is immutable. Missing, blank, malformed, zero-address, equal package/reviewer,
 * or invalid reviewer-name values fail closed as `not_configured`.
 */

import "server-only";

import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";

/** Canonical Sui zero address (64 zero hex digits). */
const SUI_ZERO_ADDRESS = "0x" + "0".repeat(64);

export interface ProtectedTransferConfig {
  packageId: string;
  /** Canonical reviewer/arbiter address for the escrow. */
  reviewerAddress: string;
  reviewerName: string;
}

export type ProtectedTransferConfigResult =
  | { ok: true; config: ProtectedTransferConfig }
  | { ok: false; reason: "not_configured" };

/**
 * Resolve the Protected Transfer package ID, reviewer address, and reviewer
 * name from the server environment. Returns a discriminated result; any
 * validation failure returns `{ ok: false, reason: "not_configured" }`.
 *
 * No secret, raw env value, or implementation detail escapes this function —
 * only canonical addresses plus bounded reviewer metadata on success, or a
 * single safe reason on failure.
 */
export function resolveProtectedTransferConfig(
  env: NodeJS.ProcessEnv,
): ProtectedTransferConfigResult {
  const rawPackage = env.PROTECTED_TRANSFER_PACKAGE_ID;
  const rawReviewer = env.PROTECTED_TRANSFER_REVIEWER_ADDRESS;
  const rawReviewerName = env.PROTECTED_TRANSFER_REVIEWER_NAME;

  if (typeof rawPackage !== "string" || rawPackage.trim().length === 0) {
    return { ok: false, reason: "not_configured" };
  }
  if (typeof rawReviewer !== "string" || rawReviewer.trim().length === 0) {
    return { ok: false, reason: "not_configured" };
  }
  if (typeof rawReviewerName !== "string") {
    return { ok: false, reason: "not_configured" };
  }
  const reviewerName = rawReviewerName.trim();
  if (
    reviewerName.length === 0 ||
    Array.from(reviewerName).length > 80 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(reviewerName)
  ) {
    return { ok: false, reason: "not_configured" };
  }

  let packageId: string;
  let reviewerAddress: string;
  try {
    packageId = normalizeSuiAddress(rawPackage.trim());
    reviewerAddress = normalizeSuiAddress(rawReviewer.trim());
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  if (!isValidSuiAddress(packageId) || packageId === SUI_ZERO_ADDRESS) {
    return { ok: false, reason: "not_configured" };
  }
  if (!isValidSuiAddress(reviewerAddress) || reviewerAddress === SUI_ZERO_ADDRESS) {
    return { ok: false, reason: "not_configured" };
  }
  // The package and reviewer must be distinct on-chain coordinates.
  if (packageId === reviewerAddress) {
    return { ok: false, reason: "not_configured" };
  }

  return { ok: true, config: { packageId, reviewerAddress, reviewerName } };
}
