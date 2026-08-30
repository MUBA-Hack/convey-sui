import { describe, expect, it } from "vitest";

/**
 * Focused unit tests for the wallet sign-in state model.
 *
 * The classifier maps thrown connect errors to a bounded customer-facing kind.
 * It must never echo OAuth/token/salt/key material back to the customer: the
 * message table is fixed and generic. Unknown errors fail closed to "failed".
 */
import {
  classifySignInError,
  signInMessage,
  type SignInErrorKind,
  type SignInStage,
} from "@/components/wallet/sign-in-state";

describe("classifySignInError — popup blocked", () => {
  it("maps the Enoki 'Failed to open popup' error to 'blocked'", () => {
    expect(classifySignInError(new Error("Failed to open popup"))).toBe("blocked");
  });

  it("is case-insensitive for the blocked signal", () => {
    expect(classifySignInError(new Error("FAILED TO OPEN POPUP"))).toBe("blocked");
  });
});

describe("classifySignInError — popup closed by user", () => {
  it("maps the Enoki 'Popup closed' error to 'cancelled'", () => {
    expect(classifySignInError(new Error("Popup closed"))).toBe("cancelled");
  });
});

describe("classifySignInError — unknown failures fail closed", () => {
  it("maps any other error to 'failed'", () => {
    expect(classifySignInError(new Error("network down"))).toBe("failed");
    expect(classifySignInError(new Error("jwt expired"))).toBe("failed");
  });

  it("maps non-Error throwables to 'failed'", () => {
    expect(classifySignInError("something odd")).toBe("failed");
    expect(classifySignInError(undefined)).toBe("failed");
    expect(classifySignInError(null)).toBe("failed");
  });
});

describe("signInMessage — customer-readable, no jargon, no secrets", () => {
  const kinds: SignInErrorKind[] = ["blocked", "cancelled", "failed"];

  it("returns a non-empty message for every kind", () => {
    for (const kind of kinds) {
      expect(signInMessage(kind).length).toBeGreaterThan(0);
    }
  });

  it("never leaks implementation jargon into customer copy", () => {
    const jargon = ["enoki", "zklogin", "oauth", "jwt", "token", "salt", "api", "dapp-kit"];
    for (const kind of kinds) {
      const msg = signInMessage(kind).toLowerCase();
      for (const term of jargon) {
        expect(msg).not.toContain(term);
      }
    }
  });

  it("never echoes a thrown error message through signInMessage", () => {
    // The message table is static; it must not interpolate error text.
    const secret = "Bearer ya29.a0ARrdaM_SECRET_VALUE";
    const kind = classifySignInError(new Error(secret));
    expect(signInMessage(kind)).not.toContain(secret);
    expect(signInMessage(kind)).not.toContain("SECRET");
  });
});

describe("SignInStage — bounded state model", () => {
  it("the stage union covers exactly the sign-in lifecycle", () => {
    // Compile-time check: every stage is a known literal.
    const stages: SignInStage[] = ["idle", "connecting", "blocked", "cancelled", "failed"];
    expect(stages).toHaveLength(5);
    expect(new Set(stages).size).toBe(5);
  });
});
