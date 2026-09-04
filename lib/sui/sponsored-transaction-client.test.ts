import { describe, expect, it, vi } from "vitest";
import {
  requestSponsoredProtectedTransfer,
  submitSponsoredProtectedTransfer,
} from "./sponsored-transaction-client";

describe("sponsored transaction client", () => {
  it("uses the protected sponsor endpoint and strict-parses its response", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({ kind: "sponsored", bytes: "tx-bytes", digest: "digest" }),
        { status: 200 },
      );
    });
    const result = await requestSponsoredProtectedTransfer({
      sender: "0x1",
      quote: {} as never,
      plan: {} as never,
      transactionKindBytes: "kind",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "sponsored", bytes: "tx-bytes", digest: "digest" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/sui/sponsor/protected-transfer",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("submits only the Enoki digest and wallet signature", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ kind: "submitted", digest: "chain-digest" }), {
        status: 200,
      });
    });
    const result = await submitSponsoredProtectedTransfer({
      digest: "sponsor-digest",
      signature: "wallet-signature",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "submitted", digest: "chain-digest" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(JSON.parse(String(init!.body))).toEqual({
      digest: "sponsor-digest",
      signature: "wallet-signature",
    });
  });

  it("rejects malformed success-shaped provider data", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ kind: "sponsored", bytes: "", digest: "digest" }), {
        status: 200,
      });
    });
    await expect(
      requestSponsoredProtectedTransfer({
        sender: "0x1",
        quote: {} as never,
        plan: {} as never,
        transactionKindBytes: "kind",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});
