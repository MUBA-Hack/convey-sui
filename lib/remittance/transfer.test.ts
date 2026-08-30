import { describe, expect, it } from "vitest";
import { MAX_USDC_MICRO, USDC_COIN_TYPE_TESTNET, U64_MAX } from "./constants";
import {
  authorizationToTransferInput,
  bindAuthorizationToQuote,
  buildExplorerUrl,
  buildUsdcTransfer,
  classifyPreSignError,
  extractSuccessfulDigest,
  hasValidAttestation,
  inspectFinality,
  isFailedTransactionResult,
  isTypedWalletRejection,
  isValidDigest,
  resolveTransferMode,
  validateRecipientAddress,
  type RemittanceTransferModeInput,
} from "./transfer";
import type { Attestation, CanonicalAuthorization, QuoteEnvelope } from "./quote-schema";
import {
  WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED,
  WalletStandardError,
} from "@wallet-standard/errors";

const ADDR_A = "0x" + "1234567890abcdef".repeat(4);
const ADDR_B = "0x" + "abcdef1234567890".repeat(4);
const ACCOUNT = "0x" + "22".repeat(32);
const CAP = MAX_USDC_MICRO;
const VALID_ATTESTATION: Attestation = { v: 1, hmac: "0x" + "ab".repeat(32) };

function auth(overrides: Partial<CanonicalAuthorization> = {}): CanonicalAuthorization {
  return {
    kind: "authorization",
    recipientAddress: ADDR_A,
    usdcMicro: "109000000",
    coinType: USDC_COIN_TYPE_TESTNET,
    beneficiaryRef: "R-ABCD1234",
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
    corridor: { source: "MYR", destination: "PHP" },
    youPayMinor: "50000",
    familyReceivesMinor: "610400",
    totalFeeMinor: "950",
    myrPerUsdc: "450",
    phpPerUsdc: "5600",
    fixedFeeMyr: "200",
    feeBps: 150,
    recipient: "Ana",
    destinationCity: "manila",
    purpose: null,
    maximumFamilyLimitMinor: null,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteEnvelope> = {}): QuoteEnvelope {
  return {
    kind: "quote",
    recipient: "Ana",
    destinationCity: "manila",
    destinationCountry: "Philippines",
    youPayMinor: "50000",
    youPayCurrency: "MYR",
    familyReceivesMinor: "610400",
    familyReceivesCurrency: "PHP",
    exchangeRate: { fromCurrency: "MYR", toCurrency: "PHP", rateText: "1 MYR = 12.44 PHP" },
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
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
    provenance: {
      pricing: "reference",
      sourceLabel: "Reference pricing — not a live rate",
      myrPerUsdc: "450",
      phpPerUsdc: "5600",
      fixedFeeMyr: "200",
      feeBps: 150,
    },
    corridor: { source: "MYR", destination: "PHP" },
    recipientAddress: ADDR_A,
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

describe("buildUsdcTransfer", () => {
  it("builds CoinWithBalance without splitting gas", () => {
    const tx = buildUsdcTransfer({
      usdcMicro: "108999999",
      recipientAddress: ADDR_A,
      sender: ACCOUNT,
      coinType: USDC_COIN_TYPE_TESTNET,
      productCapMicro: CAP,
    });
    const data = tx.getData() as { commands: { $kind: string }[] };
    const kinds = data.commands.map((c) => c.$kind);
    expect(kinds).toContain("$Intent");
    expect(kinds).toContain("TransferObjects");
    expect(kinds).not.toContain("SplitCoins");
  });

  it("rejects amount exceeding absolute product cap", () => {
    expect(() =>
      buildUsdcTransfer({
        usdcMicro: (CAP + 1n).toString(),
        recipientAddress: ADDR_A,
        sender: ACCOUNT,
        coinType: USDC_COIN_TYPE_TESTNET,
        productCapMicro: CAP,
      }),
    ).toThrow(/product cap/i);
  });

  it("rejects amount exceeding u64", () => {
    expect(() =>
      buildUsdcTransfer({
        usdcMicro: (U64_MAX + 1n).toString(),
        recipientAddress: ADDR_A,
        sender: ACCOUNT,
        coinType: USDC_COIN_TYPE_TESTNET,
        productCapMicro: U64_MAX,
      }),
    ).toThrow(/u64/i);
  });
});

describe("MAX_USDC_MICRO absolute cap", () => {
  it("is independent of authorization response fields", () => {
    expect(MAX_USDC_MICRO).toBe(2_000_000_000n);
    expect(MAX_USDC_MICRO).toBeGreaterThan(109_000_000n);
  });
});

describe("bindAuthorizationToQuote", () => {
  it("accepts an exact match", () => {
    expect(bindAuthorizationToQuote(auth(), quote())).toBeNull();
  });

  it("rejects substituted recipient with otherwise valid values", () => {
    expect(bindAuthorizationToQuote(auth({ recipientAddress: ADDR_B }), quote())).toBe(
      "verification",
    );
  });

  it("rejects substituted amount inside the absolute cap", () => {
    expect(bindAuthorizationToQuote(auth({ usdcMicro: "108000000" }), quote())).toBe(
      "verification",
    );
  });

  it("rejects wrong coin type", () => {
    expect(bindAuthorizationToQuote(auth({ coinType: "0xwrong::usdc::USDC" }), quote())).toBe(
      "verification",
    );
  });

  it("rejects a tampered purpose (rule is bound to the authorization)", () => {
    const q = quote({
      intentReview: {
        reviewer: "local",
        mode: "fallback",
        provider: "deterministic",
        fallbackReason: "not_configured",
        purpose: "school supplies",
        maximumFamilyLimitMinor: null,
        ruleStatus: "within_limit",
      },
    });
    // Auth carries null purpose; quote carries "school supplies" → mismatch.
    expect(bindAuthorizationToQuote(auth(), q)).toBe("verification");
  });

  it("rejects a tampered maximumFamilyLimitMinor (rule is bound to the authorization)", () => {
    const q = quote({
      intentReview: {
        reviewer: "local",
        mode: "fallback",
        provider: "deterministic",
        fallbackReason: "not_configured",
        purpose: null,
        maximumFamilyLimitMinor: "52000",
        ruleStatus: "within_limit",
      },
    });
    // Auth carries null cap; quote carries "52000" → mismatch.
    expect(bindAuthorizationToQuote(auth(), q)).toBe("verification");
  });

  it("accepts an exact match when both auth and quote carry the same rule", () => {
    const rule = {
      purpose: "school supplies" as const,
      maximumFamilyLimitMinor: "52000" as const,
    };
    const q = quote({
      intentReview: {
        reviewer: "local",
        mode: "fallback",
        provider: "deterministic",
        fallbackReason: "not_configured",
        purpose: rule.purpose,
        maximumFamilyLimitMinor: rule.maximumFamilyLimitMinor,
        ruleStatus: "within_limit",
      },
    });
    expect(bindAuthorizationToQuote(auth(rule), q)).toBeNull();
  });

  it("rejects over-cap: an authorized max below the send amount (core execution invariant)", () => {
    // Send RM500 (50000 sen), authorized cap RM400 (40000 sen) — cap below amount.
    expect(
      bindAuthorizationToQuote(
        auth({ maximumFamilyLimitMinor: "40000" }),
        quote({
          intentReview: {
            reviewer: "local",
            mode: "fallback",
            provider: "deterministic",
            fallbackReason: "not_configured",
            purpose: null,
            maximumFamilyLimitMinor: "40000",
            ruleStatus: "within_limit",
          },
        }),
      ),
    ).toBe("over_cap");
  });
});

describe("authorizationToTransferInput", () => {
  it("forces client-pinned coin type and absolute cap", () => {
    const input = authorizationToTransferInput(auth(), ACCOUNT);
    expect(input.coinType).toBe(USDC_COIN_TYPE_TESTNET);
    expect(input.productCapMicro).toBe(MAX_USDC_MICRO);
  });
});

describe("resolveTransferMode", () => {
  const base: RemittanceTransferModeInput = {
    account: ACCOUNT,
    network: "testnet",
    authorizedRecipient: ADDR_A,
    attestation: VALID_ATTESTATION,
  };

  it("returns real only with wallet, testnet, recipient, and attestation", () => {
    expect(resolveTransferMode(base)).toBe("real");
  });

  it("returns prepared without attestation", () => {
    expect(resolveTransferMode({ ...base, attestation: null })).toBe("prepared");
  });
});

describe("result inspection", () => {
  it("recognizes FailedTransaction structurally", () => {
    expect(
      isFailedTransactionResult({
        $kind: "FailedTransaction",
        FailedTransaction: { digest: "abc", status: { success: false } },
      }),
    ).toBe(true);
  });

  it("extractSuccessfulDigest returns null on FailedTransaction", () => {
    expect(
      extractSuccessfulDigest({
        $kind: "FailedTransaction",
        FailedTransaction: { digest: "abc", status: { success: false } },
      }),
    ).toBeNull();
  });

  it("extractSuccessfulDigest returns digest on Transaction", () => {
    expect(
      extractSuccessfulDigest({
        $kind: "Transaction",
        Transaction: { digest: "abc", status: { success: true } },
      }),
    ).toBe("abc");
  });

  it("inspectFinality requires effects.status.status === success", () => {
    expect(inspectFinality({ digest: "x", effects: { status: { status: "success" } } }, "x")).toBe(
      "success",
    );
    expect(inspectFinality({ digest: "x", effects: { status: { status: "failure" } } }, "x")).toBe(
      "failure",
    );
    expect(inspectFinality({ digest: "x" }, "x")).toBe("pending");
    expect(inspectFinality(null, "x")).toBe("pending");
    expect(
      inspectFinality({ digest: "y", effects: { status: { status: "success" } } }, "x"),
    ).toBe("pending");
  });
});

describe("typed rejection", () => {
  it("recognizes Wallet Standard REQUEST_REJECTED", () => {
    expect(isTypedWalletRejection(new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED))).toBe(
      true,
    );
  });

  it("does not treat arbitrary reject/denied provider text as rejection", () => {
    expect(isTypedWalletRejection(new Error("User rejected the request"))).toBe(false);
    expect(isTypedWalletRejection(new Error("RPC denied insufficient gas"))).toBe(false);
  });

  it("classifyPreSignError only maps typed rejection", () => {
    expect(
      classifyPreSignError(new WalletStandardError(WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED)),
    ).toBe("rejection");
    expect(classifyPreSignError(new Error("User rejected the request"))).toBe("failure");
  });
});

describe("misc helpers", () => {
  it("validates addresses and digests", () => {
    expect(validateRecipientAddress(ADDR_A)).toBe(ADDR_A);
    expect(validateRecipientAddress("nope")).toBeNull();
    expect(isValidDigest("DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR")).toBe(true);
    expect(isValidDigest("nope")).toBe(false);
    expect(hasValidAttestation(VALID_ATTESTATION)).toBe(true);
    expect(hasValidAttestation(null)).toBe(false);
    expect(buildExplorerUrl("abc")).toContain("testnet");
  });
});
