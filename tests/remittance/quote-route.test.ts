import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setGonkaRemittanceRouterFactoryForTest,
  GONKA_INFERENCE_TIMEOUT_CAP_MS,
  type GonkaRemittanceRouterFactory,
} from "@/app/api/remittance/quote/route";
import type {
  GonkaRemittanceRouter,
  GonkaRemittanceCandidate,
} from "@/lib/gonka/remittance";
import type { GonkaRunResultGeneric } from "@/lib/gonka/core";

/**
 * POST /api/remittance/quote and /api/remittance/quote/verify — API route
 * tests with no network.
 *
 * The routes are deterministic and offline: the quote route parses free text
 * with the reference parser and builds a reference quote from server-side
 * config; the verify seam strictly parses the envelope, verifies the HMAC
 * attestation in constant time, enforces expiry, and binds
 * amount/config/corridor/recipient. No model, no fetch, no signer.
 */

const GOLDEN_EN = "Send RM500 to Ana in Manila";
const GOLDEN_MALAY = "Hantar RM500 kepada Ana di Manila";
const GOLDEN_REMITTANCE =
  "Hantar RM500 to Ana in Manila for school supplies; jangan lebih RM520.";
const SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDR_ANA = "0x" + "ab".repeat(32);
const ADDR_MARIA = "0x" + "cd".repeat(32);

function postReq(text: string): Request {
  return new Request("http://localhost/api/remittance/quote", {
    method: "POST",
    body: JSON.stringify({ text }),
    headers: { "content-type": "application/json" },
  });
}

function postReqMode(text: string, interpretationMode: "deterministic" | "gonka"): Request {
  return new Request("http://localhost/api/remittance/quote", {
    method: "POST",
    body: JSON.stringify({ text, interpretationMode }),
    headers: { "content-type": "application/json" },
  });
}

function verifyReq(envelope: unknown): Request {
  return new Request("http://localhost/api/remittance/quote/verify", {
    method: "POST",
    body: JSON.stringify(envelope),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("REMITTANCE_MYR_PER_USDC", "");
  vi.stubEnv("REMITTANCE_PHP_PER_USDC", "");
  vi.stubEnv("REMITTANCE_FIXED_FEE_MYR", "");
  vi.stubEnv("REMITTANCE_FEE_BPS", "");
  vi.stubEnv("REMITTANCE_MAX_MYR", "");
  vi.stubEnv("REMITTANCE_MIN_MYR", "");
  vi.stubEnv("REMITTANCE_QUOTE_TTL_MS", "");
  vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", "");
  vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", "");
  vi.stubEnv("GONKA_ROUTER_API_KEY", "");
  vi.stubEnv("REMITTANCE_GONKA_MANIFEST_JSON", "");
  __setGonkaRemittanceRouterFactoryForTest(null);
});

afterEach(() => {
  __setGonkaRemittanceRouterFactoryForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/remittance/quote — golden paths", () => {
  it("returns a full reference quote for the English golden prompt", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
    expect(body.destinationCity).toBe("manila");
    expect(body.destinationCountry).toBe("Philippines");
    expect(body.youPayMinor).toBe("50000");
    expect(body.youPayCurrency).toBe("MYR");
    expect(body.familyReceivesCurrency).toBe("PHP");
    expect(body.exchangeRate.rateText).toBe("1 MYR = 12.444444 PHP");
    expect(body.totalFeeMinor).toBe("950");
    expect(body.usdcMicro).toBe("109000000");
    expect(body.settlementRail).toBe("Sui testnet USDC");
    expect(body.payoutMethod).toBeTruthy();
    expect(body.estimatedArrival).toBeTruthy();
    expect(body.payoutStatus).toBe("Awaiting payout partner");
    expect(body.provenance.pricing).toBe("reference");
    expect(body.provenance.myrPerUsdc).toBe("450");
    expect(body.expiresAt).toBeGreaterThan(body.issuedAt);
    expect(body.recipientAddress).toBeNull();
    expect(body.beneficiaryRef).toMatch(/^R-[A-Z0-9]{8}$/);
    expect(body.attestation).toBeNull();
  });

  it("returns a full reference quote for the Malay/English golden prompt", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_MALAY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
    expect(body.destinationCity).toBe("manila");
    expect(body.youPayMinor).toBe("50000");
    expect(body.usdcMicro).toBe("109000000");
  });

  it("never returns transaction bytes, signatures, or a recipient digest", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const json = JSON.stringify(await res.json());
    expect(json).not.toContain("txBytes");
    expect(json).not.toContain("signature");
    expect(json).not.toContain("transactionBytes");
    expect(json.toLowerCase()).not.toContain("digest");
  });
});

// ---------------------------------------------------------------------------
// Gonka live review — golden family-limit request routed through a fake
// router with no network access. The candidate is UNTRUSTED; the resolver
// rebinds every field against the original text and the public manifest.
// ---------------------------------------------------------------------------

/** A valid candidate matching the golden family-limit request. */
function goldenCandidate(): GonkaRemittanceCandidate {
  return {
    recipientAlias: "Ana",
    destinationCity: "Manila",
    destinationCountry: "Philippines",
    sendAmountMyr: "500",
    purpose: "school supplies",
    maxAmountMyr: "520",
    detectedLanguage: "ms",
    explanation: "User wants to send RM500 to Ana in Manila for school supplies.",
    confidence: 0.92,
    uncertain: false,
    needsReview: false,
  };
}

/** Build a fake router factory that returns a fixed Gonka run-ok result. */
function fakeLiveRouterFactory(
  candidate: GonkaRemittanceCandidate,
): GonkaRemittanceRouterFactory {
  return () => {
    const router: GonkaRemittanceRouter = {
      run: vi.fn(async (): Promise<GonkaRunResultGeneric<GonkaRemittanceCandidate>> => ({
        type: "gonka-run-ok",
        candidate,
        metadata: {
          gonkaRequestId: "req_rem_live_1",
          responseModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
          latencyMs: 420,
          usage: { inputTokens: 42, outputTokens: 7 },
        },
        attempts: [
          {
            type: "gonka-attempt",
            kind: "PRIMARY",
            status: "SCHEMA_VALID",
            requestedAtMs: 1_700_000_000_000,
            completedAtMs: 1_700_000_000_420,
            latencyMs: 420,
            gonkaRequestId: "req_rem_live_1",
            responseModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
            usage: { inputTokens: 42, outputTokens: 7 },
          },
        ],
      })),
    };
    return router;
  };
}

describe("POST /api/remittance/quote — Gonka live review (golden family-limit)", () => {
  it("produces a quote for Ana in Manila with purpose, max RM520, within_limit, reviewed by Gonka", async () => {
    __setGonkaRemittanceRouterFactoryForTest(fakeLiveRouterFactory(goldenCandidate()));
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_REMITTANCE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    // The golden request has no explicit city; Gonka + the resolver rebind
    // Ana's unique manifest city (Manila).
    expect(body.recipient).toBe("Ana");
    expect(body.destinationCity).toBe("manila");
    expect(body.destinationCountry).toBe("Philippines");
    expect(body.youPayMinor).toBe("50000");
    expect(body.usdcMicro).toBe("109000000");
    // intentReview — live Gonka attribution with family-rule fields.
    expect(body.intentReview.reviewer).toBe("gonka");
    expect(body.intentReview.mode).toBe("live");
    expect(body.intentReview.provider).toBe("gonkarouter");
    expect(body.intentReview.requestId).toBe("req_rem_live_1");
    expect(body.intentReview.detectedLanguage).toBe("ms");
    expect(body.intentReview.confidence).toBe(0.92);
    expect(body.intentReview.purpose).toBe("school supplies");
    expect(body.intentReview.maximumFamilyLimitMinor).toBe("52000");
    expect(body.intentReview.ruleStatus).toBe("within_limit");
    // Never exposes wallet addresses, secrets, raw model output, or attempt trails.
    const json = JSON.stringify(body);
    expect(json).not.toContain("walletAddress");
    expect(json).not.toContain("transactionBytes");
    expect(json).not.toContain("attempts");
    expect(json.toLowerCase()).not.toContain("digest");
  });
});

describe("POST /api/remittance/quote — deterministic fallback (local review)", () => {
  it("returns a quote with intentReview.reviewer=local and Checked-locally provenance", async () => {
    // No Gonka API key, no test router — honest local-review fallback.
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
    expect(body.destinationCity).toBe("manila");
    expect(body.youPayMinor).toBe("50000");
    // intentReview — honest local fallback, never implies Gonka ran.
    expect(body.intentReview.reviewer).toBe("local");
    expect(body.intentReview.mode).toBe("fallback");
    expect(body.intentReview.provider).toBe("deterministic");
    expect(body.intentReview.fallbackReason).toBe("not_configured");
    expect(body.intentReview.requestId).toBeUndefined();
    expect(body.intentReview.responseModel).toBeUndefined();
    // No purpose/max in the deterministic golden-EN prompt.
    expect(body.intentReview.purpose).toBeNull();
    expect(body.intentReview.maximumFamilyLimitMinor).toBeNull();
    expect(body.intentReview.ruleStatus).toBe("not_set");
  });
});

describe("POST /api/remittance/quote — clarifications", () => {
  it("returns a clarification for a missing amount", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq("Send to Ana in Manila"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("missing_amount");
  });

  it("returns a clarification for an unsupported corridor (Tokyo)", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq("Send RM500 to Ana in Tokyo"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("unsupported_corridor");
  });

  it("returns a clarification for an amount above the cap", async () => {
    vi.stubEnv("REMITTANCE_MAX_MYR", "100000");
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq("Send RM2000 to Ana in Manila"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("amount_exceeds_max");
  });

  it("returns a clarification for an unsupported currency (USD)", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq("Send $500 to Ana in Manila"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("unsupported_currency");
  });

  it("returns a clarification for an ambiguous currency", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq("Send RM500 and $100 to Ana in Manila"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("ambiguous_currency");
  });
});

describe("POST /api/remittance/quote — env overrides and per-beneficiary recipient", () => {
  it("uses env-overridden reference rates", async () => {
    vi.stubEnv("REMITTANCE_MYR_PER_USDC", "400");
    vi.stubEnv("REMITTANCE_PHP_PER_USDC", "6000");
    vi.stubEnv("REMITTANCE_FIXED_FEE_MYR", "0");
    vi.stubEnv("REMITTANCE_FEE_BPS", "0");
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.usdcMicro).toBe("125000000");
    expect(body.familyReceivesMinor).toBe("750000");
    expect(body.exchangeRate.rateText).toBe("1 MYR = 15.000000 PHP");
    expect(body.provenance.myrPerUsdc).toBe("400");
    expect(body.provenance.phpPerUsdc).toBe("6000");
  });

  it("carries a per-beneficiary recipient address when mapped", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipientAddress).toBe(ADDR_ANA);
  });

  it("resolves different beneficiaries independently", async () => {
    vi.stubEnv(
      "REMITTANCE_RECIPIENTS_JSON",
      JSON.stringify({ ana: ADDR_ANA, maria: ADDR_MARIA }),
    );
    const { POST } = await import("@/app/api/remittance/quote/route");
    const resAna = await POST(postReq("Send RM500 to Ana in Manila"));
    const bodyAna = await resAna.json();
    expect(bodyAna.recipientAddress).toBe(ADDR_ANA);
    const resMaria = await POST(postReq("Send RM500 to Maria in Cebu"));
    const bodyMaria = await resMaria.json();
    expect(bodyMaria.recipientAddress).toBe(ADDR_MARIA);
  });

  it("nulls the recipient address when the alias is not mapped", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ maria: ADDR_MARIA }));
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipientAddress).toBeNull();
  });

  it("nulls the recipient address when the mapped value is invalid", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: "not-an-address" }));
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipientAddress).toBeNull();
  });

  it("attestation is present when a signing secret and mapped recipient exist", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.attestation).not.toBeNull();
    expect(body.attestation.v).toBe(1);
    expect(body.attestation.hmac).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("attestation is null when a secret is set but no recipient is mapped", async () => {
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.attestation).toBeNull();
  });

  it("never leaks the signing secret in the response", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const json = JSON.stringify(await res.json());
    expect(json).not.toContain(SECRET);
  });
});

describe("POST /api/remittance/quote — strict API", () => {
  it("rejects invalid JSON with a 400", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a body without a text field with a 400", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects text exceeding MAX_REMITTANCE_INPUT_LENGTH with a 400", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({ text: "a".repeat(501) }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a locale field (strict schema, no unused locale)", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({ text: GOLDEN_EN, locale: "en" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/remittance/quote — unsafe env ints", () => {
  it("falls back to defaults when a TTL is below the minimum", async () => {
    vi.stubEnv("REMITTANCE_QUOTE_TTL_MS", "5000");
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    // Default TTL is 600000 (10 minutes).
    expect(body.expiresAt - body.issuedAt).toBe(600_000);
  });

  it("falls back to defaults when fee bps is above 10000", async () => {
    vi.stubEnv("REMITTANCE_FEE_BPS", "99999");
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_EN));
    const body = await res.json();
    expect(body.kind).toBe("quote");
    // Default fee bps is 150.
    expect(body.provenance.feeBps).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// interpretationMode — deterministic bypass + Gonka inference budget cap.
// ---------------------------------------------------------------------------

describe("POST /api/remittance/quote — interpretationMode", () => {
  it("deterministic mode never calls an injected router factory/run and returns a structured_input quote", async () => {
    const factory = vi.fn(
      (): GonkaRemittanceRouterFactory => () => {
        const router: GonkaRemittanceRouter = {
          run: vi.fn(async () => {
            throw new Error("router.run must not be called in deterministic mode");
          }),
        };
        return router;
      },
    ) as unknown as GonkaRemittanceRouterFactory;
    __setGonkaRemittanceRouterFactoryForTest(factory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode(GOLDEN_EN, "deterministic"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.recipient).toBe("Ana");
    expect(body.youPayMinor).toBe("50000");
    expect(body.intentReview.reviewer).toBe("local");
    expect(body.intentReview.fallbackReason).toBe("structured_input");
    expect(factory).not.toHaveBeenCalled();
  });

  it("deterministic mode still returns exact clarifications (missing amount)", async () => {
    __setGonkaRemittanceRouterFactoryForTest(fakeLiveRouterFactory(goldenCandidate()));
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode("Send to Ana in Manila", "deterministic"));
    const body = await res.json();
    expect(body.kind).toBe("clarification");
    expect(body.clarification.code).toBe("missing_amount");
  });

  it("gonka mode (explicit) still invokes the injected router and returns a live review", async () => {
    const factory = fakeLiveRouterFactory(goldenCandidate());
    __setGonkaRemittanceRouterFactoryForTest(factory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode(GOLDEN_REMITTANCE, "gonka"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.intentReview.reviewer).toBe("gonka");
    expect(body.intentReview.requestId).toBe("req_rem_live_1");
  });

  it("omitted interpretationMode still invokes the injected router (backward compatible)", async () => {
    const factory = fakeLiveRouterFactory(goldenCandidate());
    __setGonkaRemittanceRouterFactoryForTest(factory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReq(GOLDEN_REMITTANCE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.intentReview.reviewer).toBe("gonka");
  });

  it("injected factory observes timeout <= cap and maxRetries 0", async () => {
    const observed: { timeoutMs?: number; maxRetries?: number }[] = [];
    const factory: GonkaRemittanceRouterFactory = (cfg) => {
      observed.push({ timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries });
      return fakeLiveRouterFactory(goldenCandidate())(cfg);
    };
    __setGonkaRemittanceRouterFactoryForTest(factory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode(GOLDEN_REMITTANCE, "gonka"));
    expect(res.status).toBe(200);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.maxRetries).toBe(0);
    expect(observed[0]!.timeoutMs).toBeLessThanOrEqual(GONKA_INFERENCE_TIMEOUT_CAP_MS);
  });

  it("a lower configured timeout is preserved (not raised to the cap)", async () => {
    vi.stubEnv("GONKA_REQUEST_TIMEOUT_MS", "2000");
    const observed: { timeoutMs?: number; maxRetries?: number }[] = [];
    const factory: GonkaRemittanceRouterFactory = (cfg) => {
      observed.push({ timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries });
      return fakeLiveRouterFactory(goldenCandidate())(cfg);
    };
    __setGonkaRemittanceRouterFactoryForTest(factory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode(GOLDEN_REMITTANCE, "gonka"));
    expect(res.status).toBe(200);
    expect(observed[0]!.timeoutMs).toBe(2000);
    expect(observed[0]!.maxRetries).toBe(0);
  });

  it("provider failure still returns deterministic/provider_error under gonka mode", async () => {
    const errFactory: GonkaRemittanceRouterFactory = () => ({
      run: vi.fn(async () => ({
        type: "gonka-run-err" as const,
        reason: "PROVIDER_ERROR" as const,
        attempts: [],
      })),
    });
    __setGonkaRemittanceRouterFactoryForTest(errFactory);
    const { POST } = await import("@/app/api/remittance/quote/route");
    const res = await POST(postReqMode(GOLDEN_EN, "gonka"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("quote");
    expect(body.intentReview.reviewer).toBe("local");
    expect(body.intentReview.fallbackReason).toBe("provider_error");
  });

  it("rejects an invalid interpretationMode value with a 400", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({ text: GOLDEN_EN, interpretationMode: "fast" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects an extra field alongside interpretationMode (strict object)", async () => {
    const { POST } = await import("@/app/api/remittance/quote/route");
    const req = new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({
        text: GOLDEN_EN,
        interpretationMode: "deterministic",
        extra: 1,
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Verify seam
// ---------------------------------------------------------------------------

async function getQuote(text: string): Promise<Record<string, unknown>> {
  const { POST } = await import("@/app/api/remittance/quote/route");
  const res = await POST(postReq(text));
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/remittance/quote/verify — happy path", () => {
  it("returns a canonical authorization for a valid attested quote", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(quote));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("authorization");
    expect(body.recipientAddress).toBe(ADDR_ANA);
    expect(body.usdcMicro).toBe("109000000");
    expect(body.coinType).toBeTruthy();
    expect(body.beneficiaryRef).toMatch(/^R-[A-Z0-9]{8}$/);
  });
});

describe("POST /api/remittance/quote/verify — fail closed", () => {
  it("rejects when the signing secret is absent (quote stays prepared)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    const quote = await getQuote(GOLDEN_EN);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(quote));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("rejects when the attestation is wrong (modified signature)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    // Tamper the HMAC.
    const tampered = {
      ...quote,
      attestation: { v: 1, hmac: "0x" + "0".repeat(64) },
    };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("rejects when the amount is tampered", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const tampered = { ...quote, usdcMicro: "999999999" };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("rejects when the recipient is tampered", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const tampered = { ...quote, recipientAddress: "0x" + "99".repeat(32) };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unmapped_recipient");
  });

  it("rejects when the rates are tampered", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const tampered = {
      ...quote,
      provenance: { ...(quote.provenance as object), myrPerUsdc: "1" },
    };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("rejects when the family-rule purpose is tampered (rule is bound to the HMAC)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    // Use the golden family-limit request so the quote carries a purpose.
    const quote = await getQuote(GOLDEN_REMITTANCE);
    const tampered = {
      ...quote,
      intentReview: {
        ...(quote.intentReview as object),
        purpose: "tuition",
      },
    };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("rejects when the family-rule maximumFamilyLimitMinor is tampered (rule is bound to the HMAC)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_REMITTANCE);
    const tampered = {
      ...quote,
      intentReview: {
        ...(quote.intentReview as object),
        maximumFamilyLimitMinor: "99999",
      },
    };
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(tampered));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unverified");
  });

  it("verifies and returns the rule fields in the canonical authorization for the golden family-limit request", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_REMITTANCE);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(quote));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("authorization");
    expect(body.purpose).toBe("school supplies");
    expect(body.maximumFamilyLimitMinor).toBe("52000");
  });

  it("rejects an expired quote", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    vi.stubEnv("REMITTANCE_QUOTE_TTL_MS", "10000");
    const quote = await getQuote(GOLDEN_EN);
    // Fast-forward time past expiry.
    const realNow = Date.now;
    const future = (quote.expiresAt as number) + 1000;
    Date.now = vi.fn(() => future) as unknown as () => number;
    try {
      const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
      const res = await verifyPost(verifyReq(quote));
      const body = await res.json();
      expect(body.kind).toBe("rejected");
      expect(body.reason).toBe("expired");
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects an invalid envelope (not a quote)", async () => {
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq({ kind: "clarification" }));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("invalid_envelope");
  });

  it("rejects an unmapped recipient", async () => {
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    // No REMITTANCE_RECIPIENTS_JSON — Ana is not mapped.
    const quote = await getQuote(GOLDEN_EN);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(quote));
    const body = await res.json();
    expect(body.kind).toBe("rejected");
    expect(body.reason).toBe("unmapped_recipient");
  });

  it("never leaks the secret in the verify response", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const res = await verifyPost(verifyReq(quote));
    const json = JSON.stringify(await res.json());
    expect(json).not.toContain(SECRET);
    expect(json.toLowerCase()).not.toContain("hmac");
    expect(json.toLowerCase()).not.toContain("signature");
  });

  it("evidence mode accepts an expired-but-genuine quote and never authorizes execution", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    vi.stubEnv("REMITTANCE_QUOTE_TTL_MS", "10000");
    const quote = await getQuote(GOLDEN_EN);
    // Fast-forward time past expiry.
    const realNow = Date.now;
    const future = (quote.expiresAt as number) + 1000;
    Date.now = vi.fn(() => future) as unknown as () => number;
    try {
      const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
      const evidenceReq = new Request(
        "http://localhost/api/remittance/quote/verify?evidence=1",
        {
          method: "POST",
          body: JSON.stringify(quote),
          headers: { "content-type": "application/json" },
        },
      );
      const res = await verifyPost(evidenceReq);
      const body = await res.json();
      // Evidence mode returns kind: "evidence" — never "authorization".
      expect(body.kind).toBe("evidence");
      expect(body.expired).toBe(true);
      expect(body.recipientAddress).toBe(ADDR_ANA);
      expect(body.beneficiaryRef).toMatch(/^R-[A-Z0-9]{8}$/);
      // The note must explicitly state the quote cannot authorize a transfer.
      expect(body.note).toMatch(/can no longer be used for payment/i);
      // No execution fields leak into the evidence response.
      expect(body.usdcMicro).toBeUndefined();
      expect(body.coinType).toBeUndefined();
    } finally {
      Date.now = realNow;
    }
  });

  it("evidence mode still rejects an unattested quote (no false evidence)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    // No signing key — attestation cannot verify.
    const quote = await getQuote(GOLDEN_EN);
    const realNow = Date.now;
    const future = (quote.expiresAt as number) + 1000;
    Date.now = vi.fn(() => future) as unknown as () => number;
    try {
      const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
      const evidenceReq = new Request(
        "http://localhost/api/remittance/quote/verify?evidence=1",
        {
          method: "POST",
          body: JSON.stringify(quote),
          headers: { "content-type": "application/json" },
        },
      );
      const res = await verifyPost(evidenceReq);
      const body = await res.json();
      expect(body.kind).toBe("rejected");
      expect(body.reason).toBe("unverified");
    } finally {
      Date.now = realNow;
    }
  });

  it("evidence mode returns authorization for an unexpired quote (normal Pay flow unaffected)", async () => {
    vi.stubEnv("REMITTANCE_RECIPIENTS_JSON", JSON.stringify({ ana: ADDR_ANA }));
    vi.stubEnv("REMITTANCE_QUOTE_SIGNING_KEY_HEX", SECRET);
    const quote = await getQuote(GOLDEN_EN);
    const { POST: verifyPost } = await import("@/app/api/remittance/quote/verify/route");
    const evidenceReq = new Request(
      "http://localhost/api/remittance/quote/verify?evidence=1",
      {
        method: "POST",
        body: JSON.stringify(quote),
        headers: { "content-type": "application/json" },
      },
    );
    const res = await verifyPost(evidenceReq);
    const body = await res.json();
    // Unexpired quote still returns authorization even with evidence=1.
    expect(body.kind).toBe("authorization");
  });
});
