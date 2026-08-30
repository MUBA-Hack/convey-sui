import { describe, expect, it } from "vitest";
import {
  evaluateFamilyGuardian,
  type FamilyGuardianInput,
} from "@/lib/remittance/family-guardian";
import type { QuoteEnvelope } from "@/lib/remittance/quote-schema";

const ADDR = "0x" + "ab".repeat(32);
const VALID_ATTESTATION = { v: 1 as const, hmac: "0x" + "0c".repeat(32) };
const NOW = 1_700_000_000_000;

function baseQuote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.444444 PHP" },
    totalFeeMinor: "950",
    feeCurrency: "MYR",
    fixedFeeMinor: "200",
    feeBps: 150,
    usdcMicro: "109000000",
    usdcAmount: "109",
    settlementRail: "Sui testnet USDC",
    payoutMethod: "Bank payout · Not available yet",
    estimatedArrival: "Within minutes after on-chain confirmation",
    payoutStatus: "Awaiting payout partner",
    issuedAt: NOW,
    expiresAt: NOW + 120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR,
    beneficiaryRef: "R-ABCD1234",
    attestation: VALID_ATTESTATION,
    intentReview: {
      reviewer: "local",
      mode: "fallback",
      provider: "deterministic",
      fallbackReason: "not_configured",
      purpose: null,
      maximumFamilyLimitMinor: null,
      ruleStatus: "not_set",
    },
    clarification: null,
    ...overrides,
  };
}

function guard(
  quote: QuoteEnvelope,
  blocker: FamilyGuardianInput["blocker"] = "none",
  now: number = NOW,
) {
  return evaluateFamilyGuardian({ quote, blocker, now });
}

function checkById(report: ReturnType<typeof evaluateFamilyGuardian>, id: string) {
  const c = report.checks.find((c) => c.id === id);
  if (!c) throw new Error(`check ${id} missing`);
  return c;
}

describe("evaluateFamilyGuardian — overall state", () => {
  it("is ready when all prerequisites pass and blocker is none", () => {
    const r = guard(baseQuote(), "none");
    expect(r.overall).toBe("ready");
    expect(r.checks).toHaveLength(6);
  });

  it("is blocked when the quote is expired", () => {
    const r = guard(baseQuote({ expiresAt: NOW - 1 }), "none", NOW);
    expect(r.overall).toBe("blocked");
  });

  it("is blocked when the recipient is not pinned (unmapped)", () => {
    const r = guard(baseQuote({ recipientAddress: null }), "unmapped");
    expect(r.overall).toBe("blocked");
  });

  it("is blocked when the family limit is exceeded", () => {
    const r = guard(
      baseQuote({
        youPayMinor: "80000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    );
    expect(r.overall).toBe("blocked");
  });

  it("is blocked when the wallet is not connected", () => {
    const r = guard(baseQuote(), "wallet");
    expect(r.overall).toBe("blocked");
  });

  it("is blocked when the wallet is on the wrong network", () => {
    const r = guard(baseQuote(), "wrong-network");
    expect(r.overall).toBe("blocked");
  });

  it("is blocked when the quote is unapproved (no attestation)", () => {
    const r = guard(baseQuote({ attestation: null }), "unapproved");
    expect(r.overall).toBe("blocked");
  });
});

describe("evaluateFamilyGuardian — recipient check", () => {
  it("passes when a canonical recipient address is pinned", () => {
    const r = guard(baseQuote());
    expect(checkById(r, "recipient").status).toBe("pass");
  });

  it("fails closed when the recipient address is null", () => {
    const r = guard(baseQuote({ recipientAddress: null }), "unmapped");
    expect(checkById(r, "recipient").status).toBe("fail");
  });
});

describe("evaluateFamilyGuardian — asset & network check", () => {
  it("passes for a schema-valid envelope pinned to testnet USDC", () => {
    const r = guard(baseQuote());
    const c = checkById(r, "asset-network");
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/testnet/i);
    expect(c.detail).toMatch(/usdc/i);
  });

  it("requires the exact canonical rail 'Sui testnet USDC' — not a regex match", () => {
    const r = guard(baseQuote({ settlementRail: "Sui testnet USDC" }));
    expect(checkById(r, "asset-network").status).toBe("pass");
  });

  it("fails closed for a rail that regex-matches testnet+usdc but is not the exact canonical string", () => {
    // e.g. a tampered or alternate corridor labelled "Sui testnet USDC (preview)".
    // The schema allows any 1..60 char string, so the guardian must pin the exact
    // canonical settlement rail rather than accept a loose regex match.
    const r = guard(baseQuote({ settlementRail: "Sui testnet USDC (preview)" }));
    expect(checkById(r, "asset-network").status).toBe("fail");
  });

  it("fails closed for a rail with trailing whitespace around the canonical string", () => {
    const r = guard(baseQuote({ settlementRail: " Sui testnet USDC " }));
    expect(checkById(r, "asset-network").status).toBe("fail");
  });

  it("fails closed for a mainnet rail even though it mentions USDC", () => {
    const r = guard(baseQuote({ settlementRail: "Sui mainnet USDC" }));
    expect(checkById(r, "asset-network").status).toBe("fail");
  });
});

describe("evaluateFamilyGuardian — family purpose evidence", () => {
  it("surfaces a purpose check that truthfully reports a stated purpose", () => {
    const r = guard(
      baseQuote({
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: null,
          ruleStatus: "not_set",
        },
      }),
    );
    const c = checkById(r, "purpose");
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/rent/i);
  });

  it("surfaces a not-stated status when no purpose was stated — never a pass", () => {
    // An absent optional purpose is honest non-information, not a checked
    // prerequisite. Showing "pass" would falsely imply the purpose was
    // reviewed and cleared; the truthful status is not-stated.
    const r = guard(baseQuote());
    const c = checkById(r, "purpose");
    expect(c.status).toBe("not-stated");
    expect(c.detail).not.toMatch(/rent|tuition|bill/i);
  });

  it("treats an absent purpose as non-blocking evidence — overall stays ready", () => {
    // not-stated must never block: with every other check passing and blocker
    // none, the overall state stays ready even though no purpose was stated.
    const r = guard(baseQuote(), "none");
    expect(checkById(r, "purpose").status).toBe("not-stated");
    expect(r.overall).toBe("ready");
  });

  it("treats a stated purpose as passing evidence — overall stays ready", () => {
    // Purpose presence/value is bound into the intent review; it is surfaced
    // truthfully but never gates settlement. With every other check passing and
    // blocker none, the overall state stays ready regardless of the purpose.
    const r = guard(
      baseQuote({
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "tuition",
          maximumFamilyLimitMinor: null,
          ruleStatus: "not_set",
        },
      }),
      "none",
    );
    expect(checkById(r, "purpose").status).toBe("pass");
    expect(r.overall).toBe("ready");
  });

  it("never lets not-stated authorize settlement — wallet approval stays required", () => {
    // not-stated is non-blocking but grants no authority: the only remaining
    // step is still wallet approval (status required), never a pass.
    const r = guard(baseQuote(), "none");
    expect(checkById(r, "purpose").status).toBe("not-stated");
    expect(checkById(r, "approval").status).toBe("required");
  });

  it("never claims the purpose itself authorizes payment", () => {
    const r = guard(
      baseQuote({
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: null,
          ruleStatus: "not_set",
        },
      }),
    );
    const c = checkById(r, "purpose");
    expect(c.detail).not.toMatch(/authoriz|approved|settled|verified on-chain/i);
  });
});

describe("evaluateFamilyGuardian — freshness check", () => {
  it("passes when the quote has not expired", () => {
    const r = guard(baseQuote(), "none", NOW + 60_000);
    expect(checkById(r, "freshness").status).toBe("pass");
  });

  it("fails when now >= expiresAt", () => {
    const r = guard(baseQuote({ expiresAt: NOW + 60_000 }), "none", NOW + 60_000);
    expect(checkById(r, "freshness").status).toBe("fail");
  });

  it("fails closed when now is not a safe integer", () => {
    const r = guard(baseQuote(), "none", Number.MAX_SAFE_INTEGER + 1);
    expect(checkById(r, "freshness").status).toBe("fail");
  });
});

describe("evaluateFamilyGuardian — family rule check", () => {
  it("is not-stated when no family limit is set — never a pass", () => {
    // A null maximumFamilyLimitMinor means no per-transfer rule was stated on
    // this request. Showing "pass" would falsely imply the limit was reviewed
    // and cleared; the truthful status is not-stated, mirroring the purpose
    // check's truth boundary for absent optional evidence.
    const r = guard(baseQuote());
    const c = checkById(r, "family-rule");
    expect(c.status).toBe("not-stated");
    expect(c.detail).not.toMatch(/within|cleared|checked|passed/i);
  });

  it("treats an absent family limit as non-blocking — overall stays ready", () => {
    // not-stated must never block: with every other check passing and blocker
    // none, the overall state stays ready even though no family limit was set.
    const r = guard(baseQuote(), "none");
    expect(checkById(r, "family-rule").status).toBe("not-stated");
    expect(r.overall).toBe("ready");
  });

  it("never lets an absent family limit authorize settlement — wallet approval stays required", () => {
    // not-stated is non-blocking but grants no authority: the only remaining
    // step is still wallet approval (status required), never a pass.
    const r = guard(baseQuote(), "none");
    expect(checkById(r, "family-rule").status).toBe("not-stated");
    expect(checkById(r, "approval").status).toBe("required");
  });

  it("passes when the send is within the stated limit", () => {
    const r = guard(
      baseQuote({
        youPayMinor: "40000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    );
    expect(checkById(r, "family-rule").status).toBe("pass");
  });

  it("fails when the send exceeds the stated limit", () => {
    const r = guard(
      baseQuote({
        youPayMinor: "60000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    );
    expect(checkById(r, "family-rule").status).toBe("fail");
  });

  it("passes when the limit equals the send (boundary)", () => {
    const r = guard(
      baseQuote({
        youPayMinor: "50000",
        intentReview: {
          reviewer: "local",
          mode: "fallback",
          provider: "deterministic",
          fallbackReason: "not_configured",
          purpose: "rent",
          maximumFamilyLimitMinor: "50000",
          ruleStatus: "within_limit",
        },
      }),
    );
    expect(checkById(r, "family-rule").status).toBe("pass");
  });
});

describe("evaluateFamilyGuardian — wallet approval check", () => {
  it("is required (the remaining step) when blocker is none", () => {
    const r = guard(baseQuote(), "none");
    expect(checkById(r, "approval").status).toBe("required");
  });

  it("fails with a wallet-specific reason when blocker is wallet", () => {
    const r = guard(baseQuote(), "wallet");
    const c = checkById(r, "approval");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/wallet/i);
  });

  it("fails with a network-specific reason when blocker is wrong-network", () => {
    const r = guard(baseQuote(), "wrong-network");
    const c = checkById(r, "approval");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/testnet/i);
  });

  it("fails when blocker is unmapped", () => {
    const r = guard(baseQuote({ recipientAddress: null }), "unmapped");
    expect(checkById(r, "approval").status).toBe("fail");
  });

  it("does not present a short noncanonical address as pinned", () => {
    const r = guard(baseQuote({ recipientAddress: "0x1" }), "unmapped");
    expect(checkById(r, "recipient").status).toBe("fail");
  });

  it("fails when blocker is unapproved", () => {
    const r = guard(baseQuote({ attestation: null }), "unapproved");
    expect(checkById(r, "approval").status).toBe("fail");
  });
});

describe("evaluateFamilyGuardian — product language", () => {
  it("never leaks SDK, debug, or demo jargon in any check detail", () => {
    const cases: FamilyGuardianInput["blocker"][] = [
      "none",
      "wallet",
      "wrong-network",
      "unmapped",
      "unapproved",
    ];
    for (const blocker of cases) {
      const r = guard(baseQuote(blocker === "unmapped" ? { recipientAddress: null } : blocker === "unapproved" ? { attestation: null } : {}), blocker);
      for (const c of r.checks) {
        expect(c.label).not.toMatch(/mock|simulation|sdk|v1|v2|debug|hmac|attestation|nonce/i);
        expect(c.detail).not.toMatch(/mock|simulation|sdk|v1|v2|debug|hmac|attestation|nonce/i);
      }
      expect(r.headline).not.toMatch(/mock|simulation|sdk|v1|v2|debug|hmac|attestation|nonce/i);
    }
  });

  it("never claims on-chain verification or settlement before approval", () => {
    const r = guard(baseQuote(), "none");
    for (const c of r.checks) {
      expect(c.detail).not.toMatch(/verified on-chain|settled|settlement complete|confirmed on chain/i);
    }
    expect(r.headline).not.toMatch(/verified on-chain|settled|settlement complete|confirmed on chain/i);
  });

  it("uses strictly pre-verification language — never safe-to-sign, verified, authorized, or ready-for-approval", () => {
    // The blocker only checks HMAC shape upstream, so a forged 64-hex HMAC can
    // resolve blocker to `none` and reach the `ready` state here without any
    // server verification. The headline and check labels must therefore never
    // claim safe-to-sign, verified, authorized, or ready-for-approval.
    const cases: FamilyGuardianInput["blocker"][] = [
      "none",
      "wallet",
      "wrong-network",
      "unmapped",
      "unapproved",
    ];
    for (const blocker of cases) {
      const r = guard(baseQuote(blocker === "unmapped" ? { recipientAddress: null } : blocker === "unapproved" ? { attestation: null } : {}), blocker);
      for (const c of r.checks) {
        expect(c.label).not.toMatch(
          /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
        );
        expect(c.detail).not.toMatch(
          /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
        );
      }
      expect(r.headline).not.toMatch(
        /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
      );
    }
    // The ready headline is strictly pre-verification.
    expect(guard(baseQuote(), "none").headline).toBe("Ready to review.");
  });
});

describe("evaluateFamilyGuardian — forged HMAC regression", () => {
  it("a forged 64-hex HMAC with blocker none reaches ready but never claims safe/verified/authorized/ready-for-approval", () => {
    // The upstream attestation check (`hasValidAttestation`) only validates the
    // HMAC shape `/^0x[0-9a-f]{64}$/`, not a server signature. A forged HMAC of
    // the correct shape therefore passes the shape gate, the parent resolves the
    // blocker to `none`, and the guardian reaches the `ready` state. This test
    // pins the truth boundary: even in that forged-HMAC ready state, no check
    // label, detail, or the headline may claim safe-to-sign, verified,
    // authorized, or ready-for-approval. Wallet approval stays `required`.
    const FORGED_HMAC = "0x" + "de".repeat(32); // 64 hex chars, never server-issued
    const forgedQuote = baseQuote({
      attestation: { v: 1 as const, hmac: FORGED_HMAC },
    });
    const r = guard(forgedQuote, "none");
    // The shape check passes upstream, so the guardian reaches ready.
    expect(r.overall).toBe("ready");
    // Wallet approval is still the required remaining step — never a pass.
    expect(checkById(r, "approval").status).toBe("required");
    // No claim of a server-verified result anywhere in the report.
    for (const c of r.checks) {
      expect(c.label).not.toMatch(
        /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
      );
      expect(c.detail).not.toMatch(
        /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
      );
    }
    expect(r.headline).not.toMatch(
      /safe-to-sign|safe to sign|verified|authorized|authorised|ready for approval|ready for your approval/i,
    );
    expect(r.headline).toBe("Ready to review.");
  });
});
