/**
 * Bounded state model for the wallet sign-in (Enoki/Google seedless) flow.
 *
 * Pure, framework-free, and testable in isolation. The React component in
 * `connect-button.tsx` is the only consumer. No secrets, tokens, salts, or
 * OAuth details ever enter or leave this module — the message table is static
 * and generic, and unknown errors fail closed to a generic "failed" kind.
 */

/** The lifecycle of a single sign-in attempt. */
export type SignInStage = "idle" | "connecting" | "blocked" | "cancelled" | "failed";

/** A customer-facing classification of a thrown connect error. */
export type SignInErrorKind = "blocked" | "cancelled" | "failed";

/**
 * Map a thrown connect error to a bounded kind.
 *
 * The Enoki wallet throws two distinguishable errors we care about for
 * customer messaging: a blocked popup and a user-closed popup. Anything else
 * is treated as a generic failure — we never surface the raw message, which
 * could contain OAuth/token material, to the customer.
 */
export function classifySignInError(error: unknown): SignInErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (lower.includes("failed to open popup")) return "blocked";
  if (lower.includes("popup closed")) return "cancelled";
  return "failed";
}

/**
 * Static, customer-readable message for a sign-in error kind.
 *
 * No jargon (Enoki/zkLogin/OAuth/token/salt), no interpolated error text.
 */
export function signInMessage(kind: SignInErrorKind): string {
  switch (kind) {
    case "blocked":
      return "Pop-up blocked. Allow pop-ups for this site, then try again.";
    case "cancelled":
      return "Sign-in cancelled.";
    case "failed":
      return "Couldn’t sign in. Try again.";
  }
}

// Invariant: this module never reads or echoes Enoki/OAuth env values; the
// seedless-auth gate lives in components/wallet/providers.tsx alone.
