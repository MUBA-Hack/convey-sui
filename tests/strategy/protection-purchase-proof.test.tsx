// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ZeroAddress } from "ethers";
import { ProofVerifier } from "@/components/commerce/proof-verifier";
import {
  buildProtectionPurchasePlanId,
  type ProtectionPurchasePlanContent,
} from "@/lib/strategy/protection-purchase";
import {
  buildProtectionPurchaseReceipt,
  encodeProtectionPurchaseReceiptPayload,
  type ProtectionPurchaseReceiptDocument,
  type VerifiedProtectionPurchase,
} from "@/lib/strategy/protection-purchase-receipt";

const account = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const maker = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const txHash = `0x${"12".repeat(32)}`;

function receipt(): ProtectionPurchaseReceiptDocument {
  const content: ProtectionPurchasePlanContent = {
    version: 1,
    issuedAt: "2026-08-31T00:00:00.000Z",
    validUntil: "2026-08-31T00:00:30.000Z",
    chainId: 8453,
    account,
    asset: "ETH",
    orderFingerprint: `0x${"31".repeat(32)}`,
    signatureHash: `0x${"41".repeat(32)}`,
    optionBook: "0x1bdff855d6811728acadc00989e79143a2bdfded",
    collateralToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    maker,
    nonce: "7",
    signedOrderExpirySeconds: "2000000000",
    expirySeconds: "2100000000",
    strikes8d: ["230000000000"],
    pricePerContract8d: "125000000",
    premiumCapMicro: "3000000",
    estimatedPremiumMicro: "2500000",
    allowanceAmountMicro: "3000000",
    numContractsMicro: "2000000",
    referrer: ZeroAddress,
    fillDataHash: `0x${"51".repeat(32)}`,
  };
  const purchase: VerifiedProtectionPurchase = {
    kind: "verified",
    network: "base-mainnet",
    chainId: 8453,
    txHash,
    blockNumber: 123,
    buyerAddress: account,
    makerAddress: maker,
    optionAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    nonce: "7",
    premiumAmountMicro: "2500000",
    feeCollectedMicro: "10000",
    referralFeePaidMicro: "0",
    referrerAddress: ZeroAddress,
    sellerWasMaker: true,
    checkedAt: "2026-08-31T00:01:00.000Z",
  };
  return buildProtectionPurchaseReceipt({
    plan: { ...content, planId: buildProtectionPurchasePlanId(content) },
    purchase,
    exportedAt: "2026-08-31T00:01:01.000Z",
  });
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function loadViaUrl(document = receipt()) {
  const payload = encodeProtectionPurchaseReceiptPayload(document);
  window.history.replaceState({}, "", `/proof?o=${payload}`);
}

describe("ProofVerifier — portable Thetanuts purchase receipt", () => {
  it("loads query o, locally verifies it, and confirms only after a matching server re-check", async () => {
    const document = receipt();
    fetchMock.mockResolvedValue(response({ ...document.purchase, checkedAt: "2026-08-31T00:02:00.000Z" }));
    loadViaUrl(document);
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protection-purchase-status")).toHaveAttribute(
        "data-purchase-status",
        "verified",
      ),
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(/purchase confirmed/i);
    expect(screen.getByTestId("protection-purchase-stage")).toHaveTextContent(/\$2,300/);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/strategy/protection/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ txHash, plan: document.plan }),
      }),
    );
    expect(screen.getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      `https://basescan.org/tx/${txHash}`,
    );
  });

  it.each([
    [{ kind: "pending", reason: "transaction_not_found" }, "pending"],
    [{ kind: "rejected", reason: "event_mismatch" }, "rejected"],
    [{ kind: "unavailable", reason: "rpc_unavailable" }, "unavailable"],
  ] as const)("renders the %s re-check result without unlocking proof actions", async (body, kind) => {
    fetchMock.mockResolvedValue(response(body));
    loadViaUrl();
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protection-purchase-status")).toHaveAttribute(
        "data-purchase-status",
        kind,
      ),
    );
    expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export proof/i })).toBeNull();
    expect(screen.getByRole("link", { name: /inspect transaction/i })).toBeInTheDocument();
  });

  it("rejects altered carried purchase evidence even when the server response is verified", async () => {
    const document = receipt();
    fetchMock.mockResolvedValue(response({
      ...document.purchase,
      optionAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
      checkedAt: "2026-08-31T00:02:00.000Z",
    }));
    loadViaUrl(document);
    render(<ProofVerifier />);

    await waitFor(() =>
      expect(screen.getByTestId("protection-purchase-status")).toHaveAttribute(
        "data-purchase-status",
        "rejected",
      ),
    );
    expect(screen.getByTestId("receipt-page-title")).toHaveTextContent(/needs review/i);
  });

  it("recognizes raw receipt kind and reports local schema errors without calling the server", () => {
    render(<ProofVerifier />);
    fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
    fireEvent.change(screen.getByLabelText(/receipt json/i), {
      target: {
        value: JSON.stringify({ ...receipt(), purchase: { ...receipt().purchase, txHash: "0x1234" } }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/transaction hash/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies a portable o link after verification and keeps technical fields under Advanced", async () => {
    const document = receipt();
    fetchMock.mockResolvedValue(response({ ...document.purchase, checkedAt: "2026-08-31T00:02:00.000Z" }));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    loadViaUrl(document);
    render(<ProofVerifier />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy share link/i })).toBeInTheDocument(),
    );

    expect(screen.getByTestId("protection-purchase-result")).not.toHaveTextContent(/order fingerprint/i);
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]).toContain("/proof?o=");

    fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
    expect(screen.getByTestId("protection-purchase-technical")).toHaveTextContent(/order fingerprint/i);
  });
});
