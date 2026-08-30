import { describe, expect, it } from "vitest";
import type { SuiClientTypes } from "@mysten/sui/client";
import { USDC_COIN_TYPE_TESTNET } from "./constants";
import {
  verifySettlement,
  type VerifySettlementInput,
} from "./sui-settlement-verification";

const RECIPIENT = "0x" + "1234567890abcdef".repeat(4);
const OTHER = "0x" + "abcdef1234567890".repeat(4);
const DIGEST = "DnKz7eQwFR1i6Sd2L3pJ8mVoHgYsAaBcXcVbNbMzK9eR";
const OTHER_DIGEST = "9WzSziM8bVKmJKyvHX3ivQcpbwEyKBZb5swuocPL7x4D";
const USDC_MICRO = "109000000";

type TxResult = SuiClientTypes.TransactionResult<{ balanceChanges: true }>;
type TxArm = SuiClientTypes.Transaction<{ balanceChanges: true }>;

function makeArm(
  digest: string,
  balanceChanges: SuiClientTypes.BalanceChange[],
  status: SuiClientTypes.ExecutionStatus,
): TxArm {
  return {
    digest,
    signatures: [],
    epoch: null,
    status,
    balanceChanges,
    effects: undefined,
    events: undefined,
    objectTypes: undefined,
    transaction: undefined,
    bcs: undefined,
  };
}

function execError(message: string): SuiClientTypes.ExecutionError {
  return { message, $kind: "Unknown", Unknown: null } as SuiClientTypes.ExecutionError;
}

function successTx(
  digest: string,
  balanceChanges: SuiClientTypes.BalanceChange[],
): TxResult {
  return {
    $kind: "Transaction",
    Transaction: makeArm(digest, balanceChanges, { success: true, error: null }),
  };
}

function failedTx(digest: string, message: string): TxResult {
  return {
    $kind: "FailedTransaction",
    FailedTransaction: makeArm(
      digest,
      [],
      { success: false, error: execError(message) },
    ),
  };
}

function unsuccessfulTx(digest: string, message: string): TxResult {
  return {
    $kind: "Transaction",
    Transaction: makeArm(
      digest,
      [],
      { success: false, error: execError(message) },
    ),
  };
}

function bc(
  coinType: string,
  address: string,
  amount: string,
): SuiClientTypes.BalanceChange {
  return { coinType, address, amount };
}

function input(
  result: TxResult,
  overrides: Partial<VerifySettlementInput> = {},
): VerifySettlementInput {
  return {
    expectedDigest: DIGEST,
    expectedRecipientAddress: RECIPIENT,
    expectedUsdcMicro: USDC_MICRO,
    result,
    ...overrides,
  };
}

describe("verifySettlement — verified", () => {
  it("accepts an exact single USDC balance change for the recipient", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO)])),
    );
    expect(result).toEqual({
      kind: "verified",
      digest: DIGEST,
      usdcMicro: BigInt(USDC_MICRO),
      recipientAddress: RECIPIENT,
    });
  });

  it("aggregates multiple USDC entries for the recipient to an exact sum", () => {
    const result = verifySettlement(
      input(
        successTx(DIGEST, [
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, "50000000"),
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, "59000000"),
        ]),
      ),
    );
    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.usdcMicro).toBe(BigInt(USDC_MICRO));
    }
  });

  it("ignores unrelated entries (other coins, other addresses) and still verifies", () => {
    const result = verifySettlement(
      input(
        successTx(DIGEST, [
          bc("0x2::sui::SUI", RECIPIENT, "-1000000000"),
          bc(USDC_COIN_TYPE_TESTNET, OTHER, "-109000000"),
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO),
          bc("0xother::token::TOK", OTHER, "999999999"),
        ]),
      ),
    );
    expect(result.kind).toBe("verified");
  });
});

describe("verifySettlement — failed", () => {
  it("returns failed for a FailedTransaction arm", () => {
    const result = verifySettlement(input(failedTx(DIGEST, "move abort")));
    expect(result).toEqual({ kind: "failed", digest: DIGEST, error: "move abort" });
  });

  it("returns failed for a Transaction arm with unsuccessful status", () => {
    const result = verifySettlement(input(unsuccessfulTx(DIGEST, "InsufficientGas")));
    expect(result).toEqual({ kind: "failed", digest: DIGEST, error: "InsufficientGas" });
  });

  it("returns failed with null error when status has no error message", () => {
    const result = verifySettlement(
      input({
        $kind: "FailedTransaction",
        FailedTransaction: makeArm(
          DIGEST,
          [],
          { success: false, error: execError("") },
        ),
      }),
    );
    expect(result).toEqual({ kind: "failed", digest: DIGEST, error: null });
  });
});

describe("verifySettlement — unverified digest", () => {
  it("rejects a returned digest that does not match the expected digest", () => {
    const result = verifySettlement(
      input(successTx(OTHER_DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO)])),
    );
    expect(result).toEqual({ kind: "unverified", digest: OTHER_DIGEST, reason: "digest" });
  });
});

describe("verifySettlement — unverified balance_changes", () => {
  it("rejects missing balanceChanges array", () => {
    const result = verifySettlement(
      input({
        $kind: "Transaction",
        Transaction: {
          digest: DIGEST,
          signatures: [],
          epoch: null,
          status: { success: true, error: null },
          balanceChanges: undefined as unknown as SuiClientTypes.BalanceChange[],
          effects: undefined,
          events: undefined,
          objectTypes: undefined,
          transaction: undefined,
          bcs: undefined,
        },
      }),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "balance_changes" });
  });

  it("rejects an empty balanceChanges array", () => {
    const result = verifySettlement(input(successTx(DIGEST, [])));
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "balance_changes" });
  });
});

describe("verifySettlement — unverified coin_type", () => {
  it("rejects when no balance change matches the pinned USDC coin type", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc("0x2::sui::SUI", RECIPIENT, USDC_MICRO)])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "coin_type" });
  });
});

describe("verifySettlement — unverified recipient", () => {
  it("rejects when USDC changes exist but for a different recipient", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, OTHER, USDC_MICRO)])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "recipient" });
  });
});

describe("verifySettlement — unverified amount", () => {
  it("rejects an off-by-one surplus (+1)", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, "109000001")])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "amount" });
  });

  it("rejects an off-by-one deficit (-1)", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, "108999999")])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "amount" });
  });

  it("rejects a net-zero aggregated amount", () => {
    const result = verifySettlement(
      input(
        successTx(DIGEST, [
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO),
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, `-${USDC_MICRO}`),
        ]),
      ),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "amount" });
  });

  it("rejects a net-negative aggregated amount", () => {
    const result = verifySettlement(
      input(
        successTx(DIGEST, [
          bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, `-${USDC_MICRO}`),
        ]),
      ),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "amount" });
  });
});

describe("verifySettlement — unverified malformed", () => {
  it("rejects a malformed amount string (not a BigInt)", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, "not-a-number")])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "malformed" });
  });

  it("rejects a malformed recipient address in a balance change", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, "nope", USDC_MICRO)])),
    );
    expect(result).toEqual({ kind: "unverified", digest: DIGEST, reason: "malformed" });
  });

  it("rejects a malformed returned digest", () => {
    const result = verifySettlement(
      input(successTx("not-a-valid-digest!!!", [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO)])),
    );
    expect(result).toEqual({
      kind: "unverified",
      digest: "not-a-valid-digest!!!",
      reason: "malformed",
    });
  });

  it("rejects a result with no recognizable arm", () => {
    const result = verifySettlement(
      input({ $kind: "Unknown" } as unknown as TxResult),
    );
    expect(result).toEqual({ kind: "unverified", digest: null, reason: "malformed" });
  });

  it("rejects a malformed expected amount string", () => {
    const result = verifySettlement(
      input(successTx(DIGEST, [bc(USDC_COIN_TYPE_TESTNET, RECIPIENT, USDC_MICRO)]), {
        expectedUsdcMicro: "garbage",
      }),
    );
    expect(result).toEqual({ kind: "unverified", digest: null, reason: "malformed" });
  });
});
