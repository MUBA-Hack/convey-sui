// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, keccak256 } from "ethers";
import { ProtectionReviewDialog } from "@/components/strategy/protection-review-dialog";
import {
  ProtectionWalletAction,
  readProtectionPurchaseRecovery,
} from "@/components/strategy/protection-wallet-action";
import type { ShieldRecommendation } from "@/lib/strategy/shield-recommendation";
import type { Eip1193Provider, Eip1193Request } from "@/lib/strategy/protection-purchase-wallet";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
  type ProtectionPurchasePlanSummary,
} from "@/lib/strategy/protection-purchase";

const OFFER: Extract<ShieldRecommendation, { kind: "live" }> = {
  kind: "live",
  fetchedAt: "2026-08-31T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  asset: "ETH",
  optionType: "put",
  strikeUsd: 4000,
  pricePerContractUsd: 1.25,
  premiumBudgetUsd: 3,
  premiumAmountUsdc: "3000000",
  maximumLossUsdc: "3000000",
  numContracts: "40",
  collateralToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chainId: 8453,
  execution: "none",
  approvalRequired: true,
  disclosure: "Read-only protective-put preflight.",
  offerFingerprint: "0x" + "a".repeat(64),
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ProtectionReviewDialog", () => {
  it("shows customer terms and keeps implementation details out of primary copy", () => {
    render(
      <ProtectionReviewDialog
        recommendation={OFFER}
        open
        onOpenChange={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText("A floor for your ETH")).toBeInTheDocument();
    expect(screen.getByText("$4,000")).toBeInTheDocument();
    expect(screen.getByText("$3.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    const copy = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of ["sdk", "preflight", "calldata", "allowance", "rpc", "orderbinding"]) {
      expect(copy).not.toContain(banned);
    }
  });

  it("has one explicit wallet continuation and locks while pending", () => {
    const onContinue = vi.fn();
    const { rerender } = render(
      <ProtectionReviewDialog
        recommendation={OFFER}
        open
        onOpenChange={() => {}}
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    expect(onContinue).toHaveBeenCalledOnce();
    rerender(
      <ProtectionReviewDialog
        recommendation={OFFER}
        open
        pending
        onOpenChange={() => {}}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  });
});

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const MAKER = "0x2222222222222222222222222222222222222222";
const OPTION_BOOK = "0x3333333333333333333333333333333333333333";
const OPTION = "0x4444444444444444444444444444444444444444";
const REFERRER = "0x5555555555555555555555555555555555555555";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913".toLowerCase();
const APPROVAL_HASH = `0x${"b".repeat(64)}` as const;
const FILL_HASH = `0x${"c".repeat(64)}` as const;
const SECOND_FILL_HASH = `0x${"f".repeat(64)}` as const;
const erc20Interface = new Interface(["function approve(address spender, uint256 amount)"]);
const APPROVAL_DATA = erc20Interface.encodeFunctionData("approve", [OPTION_BOOK, 3_000_000n]);
const FILL_DATA = "0xabcd";

const PLAN_CONTENT: ProtectionPurchasePlanContent = {
  version: 1,
  issuedAt: "2026-08-31T12:00:00.000Z",
  validUntil: "2099-08-31T12:01:00.000Z",
  chainId: 8453,
  account: ACCOUNT,
  asset: "ETH",
  orderFingerprint: `0x${"a".repeat(64)}`,
  signatureHash: `0x${"d".repeat(64)}`,
  optionBook: OPTION_BOOK,
  collateralToken: USDC,
  maker: MAKER,
  nonce: "1",
  signedOrderExpirySeconds: "1790000000",
  expirySeconds: "1791000000",
  strikes8d: ["400000000000"],
  pricePerContract8d: "125000000",
  premiumCapMicro: "3000000",
  estimatedPremiumMicro: "3000000",
  allowanceAmountMicro: "3000000",
  numContractsMicro: "2400000",
  referrer: REFERRER,
  fillDataHash: keccak256(FILL_DATA).toLowerCase(),
};
const PLAN: ProtectionPurchasePlanSummary = {
  ...PLAN_CONTENT,
  planId: buildProtectionPurchasePlanId(PLAN_CONTENT),
};

function response(value: unknown): Response {
  return { ok: true, json: async () => value } as Response;
}

describe("ProtectionWalletAction", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: vi.fn(async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({})) },
    });
  });

  it("runs approval, fresh preparation, fill, and verified receipt in order", async () => {
    let sends = 0;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method, params }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getTransactionReceipt") return { status: "0x1" };
        if (method === "eth_sendTransaction") {
          sends += 1;
          const tx = (params as readonly unknown[])[0] as { data: string };
          expect(tx.data).toBe(sends === 1 ? APPROVAL_DATA : FILL_DATA);
          return sends === 1 ? APPROVAL_HASH : FILL_HASH;
        }
        throw new Error(method);
      }),
    };
    let plans = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/plan")) {
        plans += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          goal: "Protect ETH downside for 30 days",
          premiumBudgetUsd: 3,
          account: ACCOUNT,
          offerFingerprint: OFFER.offerFingerprint,
        });
        return response({
          kind: plans === 1 ? "ready_approval" : "ready_fill",
          plan: PLAN,
          transaction: {
            from: ACCOUNT,
            to: plans === 1 ? USDC : OPTION_BOOK,
            data: plans === 1 ? APPROVAL_DATA : FILL_DATA,
            value: "0x0",
            chainId: "0x2105",
          },
          checkedAt: "2026-08-31T12:00:00.000Z",
        });
      }
      return response({
        kind: "verified",
        network: "base-mainnet",
        chainId: 8453,
        txHash: FILL_HASH,
        blockNumber: 123,
        buyerAddress: ACCOUNT,
        makerAddress: MAKER,
        optionAddress: OPTION,
        nonce: "1",
        premiumAmountMicro: "3000000",
        feeCollectedMicro: "0",
        referralFeePaidMicro: "0",
        referrerAddress: REFERRER,
        sellerWasMaker: true,
        checkedAt: "2026-08-31T12:02:00.000Z",
      });
    }) as unknown as typeof fetch;

    render(
      <ProtectionWalletAction
        goal="Protect ETH downside for 30 days"
        premiumBudgetUsd={3}
        offerFingerprint={OFFER.offerFingerprint}
        provider={provider}
        fetcher={fetcher}
        onAdjust={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    await screen.findByRole("button", { name: "Allow up to $3.00 USDC" });
    fireEvent.click(screen.getByRole("button", { name: "Allow up to $3.00 USDC" }));
    await screen.findByRole("button", { name: "Confirm protection" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm protection" }));
    await screen.findByText("Protection active.");
    expect(screen.getByText("Confirmed on Base")).toBeInTheDocument();
    expect(plans).toBe(3);
    expect(sends).toBe(2);
    expect(screen.getByRole("link", { name: "Open receipt" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/proof\?o=/),
    );
  });

  it("durably records fill intent before asking the wallet to send", async () => {
    let recoveryAtSend: ReturnType<typeof readProtectionPurchaseRecovery> = null;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") {
          recoveryAtSend = readProtectionPurchaseRecovery();
          return FILL_HASH;
        }
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async (url: string | URL | Request) => response(
      String(url).endsWith("/plan")
        ? {
            kind: "ready_fill",
            plan: PLAN,
            transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
            checkedAt: "2026-08-31T12:00:00.000Z",
          }
        : { kind: "unavailable", reason: "rpc_unavailable" },
    )) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));
    await screen.findByRole("button", { name: "Check again" });
    expect(recoveryAtSend).toMatchObject({ kind: "fill_intent", approvalHash: null });
    expect(readProtectionPurchaseRecovery()).toMatchObject({ kind: "fill_submitted", hash: FILL_HASH });
  });

  it("reopens a safe retry generation after a canceled fill and restores it after reload", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") throw { code: 4001 };
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () => response({
      kind: "ready_fill",
      plan: PLAN,
      transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: "2026-08-31T12:00:00.000Z",
    })) as unknown as typeof fetch;
    const props = {
      goal: "Protect ETH downside for 30 days",
      premiumBudgetUsd: 3,
      offerFingerprint: OFFER.offerFingerprint,
      provider,
      fetcher,
      onAdjust: () => {},
    };

    const first = render(<ProtectionWalletAction {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));

    expect(await screen.findByRole("button", { name: "Confirm protection" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/canceled.*nothing was purchased/i);
    const recovery = readProtectionPurchaseRecovery();
    expect(recovery).toMatchObject({ kind: "ready", generation: 1 });
    expect((provider.request as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => request.method === "eth_sendTransaction")).toHaveLength(1);

    first.unmount();
    render(<ProtectionWalletAction {...props} recovery={recovery} />);
    expect(screen.getByRole("button", { name: "Connect Base wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust goal" })).toBeNull();
  });

  it("does not offer an inert goal adjustment for a lost-hash recovery", () => {
    render(
      <ProtectionWalletAction
        goal="Protect ETH downside for 30 days"
        premiumBudgetUsd={3}
        offerFingerprint={OFFER.offerFingerprint}
        recovery={{
          version: 2,
          generation: 0,
          flowId: "recovery-flow-id",
          kind: "fill_intent",
          goal: "Protect ETH downside for 30 days",
          premiumBudgetUsd: 3,
          offerFingerprint: OFFER.offerFingerprint,
          plan: PLAN,
          approvalHash: null,
          transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
        }}
        onAdjust={() => {}}
      />,
    );

    expect(screen.getByText("Purchase needs review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust goal" })).toBeNull();
  });

  it("blocks a quote that expires while the wallet switches to Base", async () => {
    const issuedAt = "2026-08-31T12:00:00.000Z";
    const validUntil = "2026-08-31T12:00:10.000Z";
    const expiringContent: ProtectionPurchasePlanContent = {
      ...PLAN_CONTENT,
      issuedAt,
      validUntil,
    };
    const expiringPlan: ProtectionPurchasePlanSummary = {
      ...expiringContent,
      planId: buildProtectionPurchasePlanId(expiringContent),
    };
    let now = Date.parse("2026-08-31T12:00:05.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let chainReads = 0;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") {
          chainReads += 1;
          return chainReads === 2 ? "0x1" : "0x2105";
        }
        if (method === "wallet_switchEthereumChain") {
          now = Date.parse(validUntil);
          return null;
        }
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () => response({
      kind: "ready_fill",
      plan: expiringPlan,
      transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: issuedAt,
    })) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));

    await screen.findByRole("alert");
    expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_switchEthereumChain" }));
    expect(provider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
    expect(readProtectionPurchaseRecovery()).toBeNull();
  });

  it("blocks sending when durable intent persistence is unavailable", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const fetcher = vi.fn(async () => response({
      kind: "ready_fill",
      plan: PLAN,
      transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: "2026-08-31T12:00:00.000Z",
    })) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));
    await screen.findByText("The wallet could not complete this request. Try again.");
    expect(provider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  });

  it("stays fail-closed when saving the returned fill hash fails", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      writes += 1;
      if (writes === 2) throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () => response({
      kind: "ready_fill",
      plan: PLAN,
      transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: "2026-08-31T12:00:00.000Z",
    })) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/transaction reference was not saved/i);
    expect(readProtectionPurchaseRecovery()).toMatchObject({ kind: "fill_intent" });
    expect(screen.queryByRole("button", { name: "Confirm protection" })).toBeNull();
  });

  it("persists an approval hash and restores approval checking after reload", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return APPROVAL_HASH;
        if (method === "eth_getTransactionReceipt") return null;
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () => response({
      kind: "ready_approval",
      plan: PLAN,
      transaction: { from: ACCOUNT, to: USDC, data: APPROVAL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: "2026-08-31T12:00:00.000Z",
    })) as unknown as typeof fetch;
    const first = render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Allow up to $3.00 USDC" }));
    await screen.findByRole("button", { name: "Check approval" });
    const recovery = readProtectionPurchaseRecovery();
    expect(recovery).toMatchObject({ kind: "approval_submitted", hash: APPROVAL_HASH });
    first.unmount();

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} recovery={recovery} onAdjust={() => {}} />);
    expect(screen.getByRole("button", { name: "Check approval" })).toBeInTheDocument();
  });

  it("closes a reverted approval generation and allows a safe retry", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return APPROVAL_HASH;
        if (method === "eth_getTransactionReceipt") return { status: "0x0" };
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () => response({
      kind: "ready_approval",
      plan: PLAN,
      transaction: { from: ACCOUNT, to: USDC, data: APPROVAL_DATA, value: "0x0", chainId: "0x2105" },
      checkedAt: "2026-08-31T12:00:00.000Z",
    })) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Allow up to $3.00 USDC" }));

    expect(await screen.findByRole("button", { name: "Connect Base wallet" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/approval failed on Base/i);
    expect(readProtectionPurchaseRecovery()).toMatchObject({ kind: "ready", generation: 1 });
    expect((provider.request as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => request.method === "eth_sendTransaction")).toHaveLength(1);
  });

  it("opens an intentional next generation while a stale fill-ready tab stays blocked", async () => {
    let sends = 0;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") {
          sends += 1;
          return sends === 1 ? FILL_HASH : SECOND_FILL_HASH;
        }
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/plan")) {
        return response({
          kind: "ready_fill",
          plan: PLAN,
          transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
          checkedAt: "2026-08-31T12:00:00.000Z",
        });
      }
      const txHash = (JSON.parse(String(init?.body)) as { txHash: `0x${string}` }).txHash;
      return response({
        kind: "verified",
        network: "base-mainnet",
        chainId: 8453,
        txHash,
        blockNumber: sends,
        buyerAddress: ACCOUNT,
        makerAddress: MAKER,
        optionAddress: OPTION,
        nonce: "1",
        premiumAmountMicro: "3000000",
        feeCollectedMicro: "0",
        referralFeePaidMicro: "0",
        referrerAddress: REFERRER,
        sellerWasMaker: true,
        checkedAt: "2026-08-31T12:02:00.000Z",
      });
    }) as unknown as typeof fetch;
    const props = {
      goal: "Protect ETH downside for 30 days",
      premiumBudgetUsd: 3,
      offerFingerprint: OFFER.offerFingerprint,
      provider,
      fetcher,
      onAdjust: () => {},
    };
    const current = render(<ProtectionWalletAction {...props} />);
    const stale = render(<ProtectionWalletAction {...props} />);
    fireEvent.click(within(current.container).getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(within(stale.container).getByRole("button", { name: "Connect Base wallet" }));
    const currentConfirm = await within(current.container).findByRole("button", { name: "Confirm protection" });
    const staleConfirm = await within(stale.container).findByRole("button", { name: "Confirm protection" });
    fireEvent.click(currentConfirm);
    fireEvent.click(await within(current.container).findByRole("button", { name: "Start a new purchase" }));
    expect(readProtectionPurchaseRecovery()).toMatchObject({ kind: "ready", generation: 1 });

    fireEvent.click(staleConfirm);
    await within(stale.container).findByRole("alert");
    expect(sends).toBe(1);
    expect(within(stale.container).queryByRole("button", { name: "Confirm protection" })).toBeInTheDocument();

    fireEvent.click(within(current.container).getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await within(current.container).findByRole("button", { name: "Confirm protection" }));
    await within(current.container).findByRole("button", { name: "Start a new purchase" });
    expect(sends).toBe(2);
  });

  it("keeps a submitted purchase verification-only when status is unavailable", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    let verifies = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/plan")) {
        return response({
          kind: "ready_fill",
          plan: PLAN,
          transaction: {
            from: ACCOUNT,
            to: OPTION_BOOK,
            data: FILL_DATA,
            value: "0x0",
            chainId: "0x2105",
          },
          checkedAt: "2026-08-31T12:00:00.000Z",
        });
      }
      verifies += 1;
      return response({ kind: "unavailable", reason: "rpc_unavailable" });
    }) as unknown as typeof fetch;

    render(
      <ProtectionWalletAction
        goal="Protect ETH downside for 30 days"
        premiumBudgetUsd={3}
        offerFingerprint={OFFER.offerFingerprint}
        provider={provider}
        fetcher={fetcher}
        onAdjust={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));
    await screen.findByRole("button", { name: "Check again" });
    expect(screen.queryByRole("button", { name: "Confirm protection" })).toBeNull();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      `https://basescan.org/tx/${FILL_HASH}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(verifies).toBe(2));
    expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
    expect((provider.request as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => request.method === "eth_sendTransaction")).toHaveLength(1);
  });

  it("closes a failed fill generation and allows a safe retry", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/plan")) {
        return response({
          kind: "ready_fill",
          plan: PLAN,
          transaction: { from: ACCOUNT, to: OPTION_BOOK, data: FILL_DATA, value: "0x0", chainId: "0x2105" },
          checkedAt: "2026-08-31T12:00:00.000Z",
        });
      }
      return response({ kind: "rejected", reason: "failed_transaction" });
    }) as unknown as typeof fetch;

    render(<ProtectionWalletAction goal="Protect ETH downside for 30 days" premiumBudgetUsd={3} offerFingerprint={OFFER.offerFingerprint} provider={provider} fetcher={fetcher} onAdjust={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));

    expect(await screen.findByRole("button", { name: "Connect Base wallet" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/transaction failed on Base/i);
    expect(readProtectionPurchaseRecovery()).toMatchObject({ kind: "ready", generation: 1 });
    expect((provider.request as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => request.method === "eth_sendTransaction")).toHaveLength(1);
  });

  it("rechecks the offer at final approval and never sends stale terms", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") return FILL_HASH;
        throw new Error(method);
      }),
    };
    let plans = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).endsWith("/plan")) throw new Error("unexpected verification");
      plans += 1;
      if (plans === 2) {
        return response({ kind: "changed", checkedAt: "2026-08-31T12:00:01.000Z" });
      }
      return response({
        kind: "ready_fill",
        plan: PLAN,
        transaction: {
          from: ACCOUNT,
          to: OPTION_BOOK,
          data: FILL_DATA,
          value: "0x0",
          chainId: "0x2105",
        },
        checkedAt: "2026-08-31T12:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    render(
      <ProtectionWalletAction
        goal="Protect ETH downside for 30 days"
        premiumBudgetUsd={3}
        offerFingerprint={OFFER.offerFingerprint}
        provider={provider}
        fetcher={fetcher}
        onAdjust={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm protection" }));
    await screen.findByText("The offer changed. Review the latest terms before continuing.");
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );
  });

  it("honors a durable cross-tab hash lock and exposes verification only", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193Request) => {
        if (method === "eth_accounts") return [ACCOUNT];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_sendTransaction") throw new Error("must not send");
        throw new Error(method);
      }),
    };
    const fetcher = vi.fn(async () =>
      response({
        kind: "ready_fill",
        plan: PLAN,
        transaction: {
          from: ACCOUNT,
          to: OPTION_BOOK,
          data: FILL_DATA,
          value: "0x0",
          chainId: "0x2105",
        },
        checkedAt: "2026-08-31T12:00:00.000Z",
      }),
    ) as unknown as typeof fetch;
    render(
      <ProtectionWalletAction
        goal="Protect ETH downside for 30 days"
        premiumBudgetUsd={3}
        offerFingerprint={OFFER.offerFingerprint}
        provider={provider}
        fetcher={fetcher}
        onAdjust={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Base wallet" }));
    const confirm = await screen.findByRole("button", { name: "Confirm protection" });
    window.localStorage.setItem(
      "convey:protection-purchase-lock:v1",
      JSON.stringify({
        version: 2,
        generation: 0,
        flowId: "other-flow-id",
        kind: "fill_submitted",
        goal: "Protect ETH downside for 30 days",
        premiumBudgetUsd: 3,
        offerFingerprint: OFFER.offerFingerprint,
        hash: FILL_HASH,
        plan: PLAN,
        approvalHash: null,
        transaction: {
          from: ACCOUNT,
          to: OPTION_BOOK,
          data: FILL_DATA,
          value: "0x0",
          chainId: "0x2105",
        },
      }),
    );
    fireEvent.click(confirm);
    await screen.findByRole("button", { name: "Check again" });
    expect(screen.queryByRole("button", { name: "Confirm protection" })).toBeNull();
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );
  });
});
