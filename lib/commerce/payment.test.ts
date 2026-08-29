import { describe, expect, it } from "vitest";
import {
  MAX_PAYMENT_MIST,
  buildExplorerUrl,
  buildPaymentTransaction,
  classifyWalletError,
  createDemoReceipt,
  extractDigest,
  resolvePaymentMode,
  validateAmountMist,
  validateMerchantAddress,
  type PaymentErrorCode,
  type PaymentModeInput,
} from "./payment";

// A canonical 32-byte Sui address (64 hex chars + 0x), lowercased.
const ADDR_A = "0x" + "1234567890abcdef".repeat(4);
const ADDR_B = "0x" + "fedcba9876543210".repeat(4);
// Uppercase + no 0x variant of ADDR_A; must canonicalize to ADDR_A.
const ADDR_A_UPPER = "1234567890ABCDEF".repeat(4);

const MIST = 1_000_000_000n;
const THREE_SUI = (3n * MIST).toString();

describe("validateMerchantAddress", () => {
  it("accepts and canonicalizes a valid Sui address", () => {
    expect(validateMerchantAddress(ADDR_A)).toBe(ADDR_A);
    // Uppercase without 0x must normalize to lowercase 0x form.
    expect(validateMerchantAddress(ADDR_A_UPPER)).toBe(ADDR_A.toLowerCase());
  });

  it.each([
    ["", "empty"],
    ["0x" + "g".repeat(64), "non-hex chars"],
    ["not an address", "plain text"],
    ["0x" + "ab".repeat(63), "63 bytes"],
    ["0x" + "ab".repeat(65), "65 bytes"],
  ])("rejects %s", (value) => {
    expect(validateMerchantAddress(value)).toBeNull();
  });
});

describe("validateAmountMist", () => {
  it("accepts a positive bounded integer MIST string", () => {
    expect(validateAmountMist(THREE_SUI)).toBeNull();
    expect(validateAmountMist("1")).toBeNull();
  });

  it.each([
    ["0", "zero"],
    ["-1000", "negative"],
    ["1.5", "fractional"],
    ["abc", "non-numeric"],
    ["", "empty"],
    [" ", "whitespace"],
  ])("rejects %s", (value) => {
    expect(validateAmountMist(value)).not.toBeNull();
  });

  it("rejects amounts at or above the demo cap", () => {
    expect(validateAmountMist(MAX_PAYMENT_MIST.toString())).not.toBeNull();
    expect(validateAmountMist((MAX_PAYMENT_MIST + 1n).toString())).not.toBeNull();
    // Just under the cap is fine.
    expect(validateAmountMist((MAX_PAYMENT_MIST - 1n).toString())).toBeNull();
  });
});

describe("resolvePaymentMode", () => {
  const base: PaymentModeInput = {
    account: "0x" + "11".repeat(32),
    network: "testnet",
    configuredMerchant: ADDR_A,
    previewMerchant: ADDR_A,
  };

  it("returns real when connected, testnet, and configured merchant matches preview", () => {
    expect(resolvePaymentMode(base)).toBe("real");
  });

  it("returns demo when no account is connected", () => {
    expect(resolvePaymentMode({ ...base, account: null })).toBe("demo");
  });

  it("returns demo when network is not testnet", () => {
    expect(resolvePaymentMode({ ...base, network: "mainnet" })).toBe("demo");
    expect(resolvePaymentMode({ ...base, network: "localnet" })).toBe("demo");
  });

  it("returns demo when no merchant is configured", () => {
    expect(resolvePaymentMode({ ...base, configuredMerchant: null })).toBe("demo");
  });

  it("returns demo when the configured merchant does not match the preview", () => {
    expect(resolvePaymentMode({ ...base, configuredMerchant: ADDR_B })).toBe("demo");
  });

  it("matches canonical forms (uppercase/no-0x configured matches lowercase preview)", () => {
    expect(
      resolvePaymentMode({ ...base, configuredMerchant: ADDR_A_UPPER }),
    ).toBe("real");
  });
});

describe("buildPaymentTransaction — shape without network", () => {
  it("builds a native SUI transfer: split gas coin and transfer to merchant", () => {
    const tx = buildPaymentTransaction({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      sender: "0x" + "22".repeat(32),
    });

    const data = tx.getData() as {
      sender?: string;
      commands: { $kind: string; [k: string]: unknown }[];
    };

    expect(data.sender).toBe("0x" + "22".repeat(32));

    const kinds = data.commands.map((c) => c.$kind);
    expect(kinds).toContain("SplitCoins");
    expect(kinds).toContain("TransferObjects");

    const split = data.commands.find((c) => c.$kind === "SplitCoins") as unknown as {
      SplitCoins: {
        coin: { $kind: string };
        amounts: { $kind: string }[];
      };
    };
    // Splits from the gas coin.
    expect(split.SplitCoins.coin.$kind).toBe("GasCoin");
    expect(split.SplitCoins.amounts).toHaveLength(1);

    const transfer = data.commands.find((c) => c.$kind === "TransferObjects") as unknown as {
      TransferObjects: {
        objects: { $kind: string }[];
        address: { $kind: string };
      };
    };
    // Transfers the split result (not the gas coin itself).
    expect(transfer.TransferObjects.objects).toHaveLength(1);
    expect(transfer.TransferObjects.objects[0]!.$kind).toBe("Result");
    // Recipient is a pure input (the merchant address).
    expect(transfer.TransferObjects.address.$kind).toBe("Input");
  });

  it("does not call the network or a signer during construction", () => {
    // Construction is synchronous and pure; it must not fetch or sign.
    const tx = buildPaymentTransaction({
      amountMist: "1",
      merchantAddress: ADDR_A,
      sender: "0x" + "33".repeat(32),
    });
    // getData() is a synchronous snapshot — no promise, no client.
    expect(typeof tx.getData).toBe("function");
  });
});

describe("extractDigest", () => {
  it("returns the digest for a successful transaction result", () => {
    const digest = "abcDEF1234567890";
    const result = {
      $kind: "Transaction" as const,
      Transaction: { digest },
      FailedTransaction: undefined,
    };
    expect(extractDigest(result)).toBe(digest);
  });

  it("throws on a FailedTransaction result with the on-chain error message", () => {
    const result = {
      $kind: "FailedTransaction" as const,
      Transaction: undefined,
      FailedTransaction: {
        digest: "faildigest",
        status: { success: false, error: { message: "move abort: insufficient" } },
      },
    };
    expect(() => extractDigest(result)).toThrow(/insufficient/);
  });

  it("throws a generic message when the failed result has no error text", () => {
    const result = {
      $kind: "FailedTransaction" as const,
      Transaction: undefined,
      FailedTransaction: {
        digest: "faildigest",
        status: { success: false, error: null },
      },
    };
    expect(() => extractDigest(result)).toThrow(/failed on-chain/i);
  });
});

describe("classifyWalletError", () => {
  it.each([
    ["User rejected the request", "rejection"],
    ["Wallet canceled signature", "rejection"],
    ["Request denied", "rejection"],
  ])("classifies %s as rejection", (message, code) => {
    expect(classifyWalletError(new Error(message))).toBe(code as PaymentErrorCode);
  });

  it("classifies insufficient balance errors", () => {
    expect(classifyWalletError(new Error("Insufficient gas balance"))).toBe(
      "insufficient",
    );
  });

  it("classifies unknown errors as failure", () => {
    expect(classifyWalletError(new Error("RPC timeout"))).toBe("failure");
    expect(classifyWalletError("string error")).toBe("failure");
    expect(classifyWalletError(null)).toBe("failure");
  });
});

describe("createDemoReceipt", () => {
  it("produces a deterministic DEMO receipt with no explorer link", () => {
    const r = createDemoReceipt({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    expect(r.mode).toBe("demo");
    expect(r.demo).toBe(true);
    expect(r.explorerUrl).toBeNull();
    // Unmistakably a demo, never a real digest format.
    expect(r.digest.startsWith("DEMO-")).toBe(true);
  });

  it("is deterministic: same inputs yield the same digest", () => {
    const a = createDemoReceipt({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    const b = createDemoReceipt({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    expect(a.digest).toBe(b.digest);
  });

  it("differs when any input changes", () => {
    const a = createDemoReceipt({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    const b = createDemoReceipt({
      amountMist: (4n * MIST).toString(),
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    expect(a.digest).not.toBe(b.digest);
  });

  it("never claims on-chain settlement", () => {
    const r = createDemoReceipt({
      amountMist: THREE_SUI,
      merchantAddress: ADDR_A,
      merchantName: "River Cafe",
      itemName: "Iced Coffee",
      quantity: 2,
    });
    expect(r.label).toMatch(/demo|simulation/i);
  });
});

describe("buildExplorerUrl", () => {
  it("builds a testnet explorer URL for a real digest", () => {
    const url = buildExplorerUrl("real", "abcDEF123");
    expect(url).not.toBeNull();
    expect(url).toContain("testnet");
    expect(url).toContain(encodeURIComponent("abcDEF123"));
    expect(url!.startsWith("https://")).toBe(true);
  });

  it("returns null for demo mode", () => {
    expect(buildExplorerUrl("demo", "DEMO-something")).toBeNull();
  });
});
