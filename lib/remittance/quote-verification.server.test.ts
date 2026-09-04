import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setGonkaRemittanceRouterFactoryForTest,
} from "@/app/api/remittance/quote/route";
import { verifyRemittanceQuote } from "@/lib/remittance/quote-verification.server";

/**
 * Direct evaluator tests for behavior not naturally controlled through the
 * route: the exact freshness interval [issuedAt, expiresAt) and the
 * fail-closed clock/config table. The route tests in
 * tests/remittance/quote-route.test.ts cover canonical auth, malformed body,
 * HMAC, amount, recipient, pricing, purpose, cap, expiry, mapping, secret
 * leakage, and evidence mode through the thin HTTP wrapper.
 */

const GOLDEN_EN = "Send RM500 to Ana in Manila";
const SECRET = "a".repeat(64);
const ADDR_ANA = "0x" + "ab".repeat(32);

async function getQuote(text: string): Promise<Record<string, unknown>> {
  const { POST } = await import("@/app/api/remittance/quote/route");
  const req = new Request("http://localhost/api/remittance/quote", {
    method: "POST",
    body: JSON.stringify({ text }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("REMITTANCE_MYR_PER_USDC", "");
  vi.stubEnv("REMITTANCE_PHP_PER_USDC", "");
  vi.stubEnv("REMITTANCE_FIXED_FEE_MYR", "");
  vi.stubEnv("REMITTANCE_FEE_BPS", "");
  vi.stubEnv("REMITTANCE_MAX_MYR", "");
  vi.stubEnv("REMITTANCE_MIN_MYR", "");
  vi.stubEnv("REMITTANCE_QUOTE_TTL_MS", "");
  vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
  vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
  vi.stubEnv("GONKA_ROUTER_API_KEY", "");
  vi.stubEnv("REMITTANCE_GONKA_MANIFEST_JSON", "");
  __setGonkaRemittanceRouterFactoryForTest(null);
});

afterEach(() => {
  __setGonkaRemittanceRouterFactoryForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyRemittanceQuote — freshness interval [issuedAt, expiresAt)", () => {
  it("binds the original request and interpreter provenance into the executable authorization", async () => {
    const quote = await getQuote(GOLDEN_EN);
    expect(quote.intentBinding).toMatchObject({
      version: "convey.financial-intent.v1",
      originalIntent: GOLDEN_EN,
      interpretation: {
        kind: "deterministic",
        provider: "deterministic",
      },
      policy: {
        engine: "convey.remittance-policy.v1",
        result: "quote_ready",
      },
    });

    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: quote.issuedAt as number,
      env: process.env,
    });
    expect(result.kind).toBe("authorization");
    if (result.kind === "authorization") {
      expect(result.intentBinding).toEqual(quote.intentBinding);
    }

    const tampered = structuredClone(quote);
    (tampered.intentBinding as { originalIntent: string }).originalIntent =
      "Send RM900 to Ana in Manila";
    expect(
      verifyRemittanceQuote({
        body: tampered,
        evidenceMode: false,
        nowMs: quote.issuedAt as number,
        env: process.env,
      }),
    ).toEqual({ kind: "rejected", reason: "unverified" });
  });

  it("accepts nowMs === issuedAt (exact lower bound)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: quote.issuedAt as number,
      env: process.env,
    });
    expect(result.kind).toBe("authorization");
  });

  it("rejects nowMs one millisecond before issuedAt", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: (quote.issuedAt as number) - 1,
      env: process.env,
    });
    expect(result).toEqual({ kind: "rejected", reason: "expired" });
  });

  it("accepts nowMs one millisecond before expiry", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: (quote.expiresAt as number) - 1,
      env: process.env,
    });
    expect(result.kind).toBe("authorization");
  });

  it("rejects nowMs === expiresAt (exact upper bound)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: quote.expiresAt as number,
      env: process.env,
    });
    expect(result).toEqual({ kind: "rejected", reason: "expired" });
  });

  it("fails closed with `expired` for an unsafe clock in normal and evidence mode", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const issuedAt = quote.issuedAt as number;
    const expiresAt = quote.expiresAt as number;
    // A safe mid-window time authorizes — proves the table below is rejected
    // by the clock value itself, not by an unrelated expiry.
    const safeMid = issuedAt + Math.trunc((expiresAt - issuedAt) / 2);
    expect(
      verifyRemittanceQuote({ body: quote, evidenceMode: false, nowMs: safeMid, env: process.env })
        .kind,
    ).toBe("authorization");

    for (const bad of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        verifyRemittanceQuote({ body: quote, evidenceMode: false, nowMs: bad, env: process.env }),
      ).toEqual({ kind: "rejected", reason: "expired" });
      // Evidence mode must also fail closed for an unsafe clock — never evidence.
      expect(
        verifyRemittanceQuote({ body: quote, evidenceMode: true, nowMs: bad, env: process.env }),
      ).toEqual({ kind: "rejected", reason: "expired" });
    }
  });

  it("evidence mode does not produce evidence when nowMs is before issuance", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: true,
      nowMs: (quote.issuedAt as number) - 1,
      env: process.env,
    });
    expect(result).toEqual({ kind: "rejected", reason: "expired" });
  });

  it("rejects an invalid resolved config as not_configured", async () => {
    const quote = await getQuote(GOLDEN_EN);
    // Break pricing so validateConfig fails after the envelope parses.
    vi.stubEnv("REMITTANCE_MYR_PER_USDC", "0");
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: false,
      nowMs: quote.issuedAt as number,
      env: process.env,
    });
    expect(result).toEqual({ kind: "rejected", reason: "not_configured" });
  });

  it("evidence mode returns evidence for a genuinely expired quote (injected-clock sanity)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const result = verifyRemittanceQuote({
      body: quote,
      evidenceMode: true,
      nowMs: (quote.expiresAt as number) + 1,
      env: process.env,
    });
    expect(result.kind).toBe("evidence");
  });
});
