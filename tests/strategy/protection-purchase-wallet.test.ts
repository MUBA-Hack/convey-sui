import { describe, expect, it, vi } from "vitest";
import { Interface, keccak256 } from "ethers";
import {
  ProtectionWalletError,
  connectBaseWallet,
  sendPreparedTransaction,
  validatePreparedProtectionTransaction,
  waitForWalletTransaction,
  type Eip1193Provider,
  type Eip1193Request,
} from "@/lib/strategy/protection-purchase-wallet";
import {
  PROTECTION_PURCHASE_CHAIN_ID_HEX as BASE_CHAIN_ID_HEX,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const TO = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"a".repeat(64)}` as const;
const COLLATERAL = "0x3333333333333333333333333333333333333333" as const;
const FILL_DATA = "0x1234" as const;
const approvalInterface = new Interface(["function approve(address spender, uint256 amount)"]);
const PLAN = {
  chainId: 8453,
  account: ACCOUNT,
  optionBook: TO,
  collateralToken: COLLATERAL,
  allowanceAmountMicro: "3000000",
  fillDataHash: keccak256(FILL_DATA).toLowerCase(),
} as ProtectionPurchasePlanSummary;

function fakeProvider(handler: (request: Eip1193Request) => unknown): Eip1193Provider {
  return { request: vi.fn(async (request) => handler(request)) };
}

describe("protection purchase wallet", () => {
  it("binds fill target, sender, chain, value, and calldata hash to the reviewed plan", () => {
    expect(() => validatePreparedProtectionTransaction("fill", {
      from: ACCOUNT,
      to: TO,
      data: FILL_DATA,
      value: "0x0",
      chainId: BASE_CHAIN_ID_HEX,
    }, PLAN)).not.toThrow();

    for (const transaction of [
      { from: ACCOUNT, to: COLLATERAL, data: FILL_DATA, value: "0x0", chainId: BASE_CHAIN_ID_HEX },
      { from: ACCOUNT, to: TO, data: "0xabcd", value: "0x0", chainId: BASE_CHAIN_ID_HEX },
      { from: ACCOUNT, to: TO, data: FILL_DATA, value: "0x1", chainId: BASE_CHAIN_ID_HEX },
    ]) {
      expect(() => validatePreparedProtectionTransaction(
        "fill",
        transaction as Parameters<typeof validatePreparedProtectionTransaction>[1],
        PLAN,
      )).toThrow(ProtectionWalletError);
    }
  });

  it("decodes approval calldata and binds exact spender and amount", () => {
    const exact = approvalInterface.encodeFunctionData("approve", [TO, 3_000_000n]) as `0x${string}`;
    expect(() => validatePreparedProtectionTransaction("approval", {
      from: ACCOUNT,
      to: COLLATERAL,
      data: exact,
      value: "0x0",
      chainId: BASE_CHAIN_ID_HEX,
    }, PLAN)).not.toThrow();

    for (const data of [
      approvalInterface.encodeFunctionData("approve", [COLLATERAL, 3_000_000n]),
      approvalInterface.encodeFunctionData("approve", [TO, 2_999_999n]),
      "0x1234",
    ]) {
      expect(() => validatePreparedProtectionTransaction("approval", {
        from: ACCOUNT,
        to: COLLATERAL,
        data: data as `0x${string}`,
        value: "0x0",
        chainId: BASE_CHAIN_ID_HEX,
      }, PLAN)).toThrow(ProtectionWalletError);
    }
  });

  it("connects an account and switches to Base before returning", async () => {
    let chain = "0x1";
    const provider = fakeProvider(({ method, params }) => {
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        expect(params).toEqual([{ chainId: BASE_CHAIN_ID_HEX }]);
        chain = BASE_CHAIN_ID_HEX;
        return null;
      }
      throw new Error(method);
    });
    await expect(connectBaseWallet(provider)).resolves.toBe(ACCOUNT);
  });

  it("blocks a changed account before sending", async () => {
    const provider = fakeProvider(({ method }) => {
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return BASE_CHAIN_ID_HEX;
      throw new Error(method);
    });
    await expect(
      sendPreparedTransaction(
        provider,
        { from: ACCOUNT, to: TO, data: "0x", value: "0x0", chainId: BASE_CHAIN_ID_HEX },
        "0x3333333333333333333333333333333333333333",
      ),
    ).rejects.toMatchObject({ code: "account_mismatch" });
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );
  });

  it("sends the exact prepared transaction without rewriting it", async () => {
    const transaction = {
      from: ACCOUNT,
      to: TO,
      data: "0x1234" as const,
      value: "0x0" as const,
      chainId: BASE_CHAIN_ID_HEX,
    };
    const provider = fakeProvider(({ method, params }) => {
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return BASE_CHAIN_ID_HEX;
      if (method === "eth_sendTransaction") {
        expect(params).toEqual([transaction]);
        return HASH;
      }
      throw new Error(method);
    });
    await expect(sendPreparedTransaction(provider, transaction, ACCOUNT)).resolves.toBe(HASH);
  });

  it("normalizes an uppercase wallet transaction hash", async () => {
    const uppercaseHash = `0x${"A".repeat(64)}`;
    const provider = fakeProvider(({ method }) => {
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return BASE_CHAIN_ID_HEX;
      if (method === "eth_sendTransaction") return uppercaseHash;
      throw new Error(method);
    });
    await expect(sendPreparedTransaction(
      provider,
      { from: ACCOUNT, to: TO, data: "0x", value: "0x0", chainId: BASE_CHAIN_ID_HEX },
      ACCOUNT,
    )).resolves.toBe(HASH);
  });

  it("classifies a customer-canceled wallet request", async () => {
    const provider = fakeProvider(({ method }) => {
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return BASE_CHAIN_ID_HEX;
      if (method === "eth_sendTransaction") throw { code: 4001 };
      throw new Error(method);
    });
    await expect(
      sendPreparedTransaction(
        provider,
        { from: ACCOUNT, to: TO, data: "0x", value: "0x0", chainId: BASE_CHAIN_ID_HEX },
        ACCOUNT,
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<ProtectionWalletError>>({ code: "rejected" }));
  });

  it("waits for confirmation and rejects a reverted transaction", async () => {
    const confirmed = fakeProvider(({ method }) => {
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw new Error(method);
    });
    await expect(waitForWalletTransaction(confirmed, HASH, { attempts: 1 })).resolves.toEqual({
      transactionHash: HASH,
      status: "0x1",
    });

    const reverted = fakeProvider(({ method }) => {
      if (method === "eth_getTransactionReceipt") return { status: "0x0" };
      throw new Error(method);
    });
    await expect(waitForWalletTransaction(reverted, HASH, { attempts: 1 })).rejects.toMatchObject({
      code: "reverted",
    });
  });
});
