import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setGonkaRemittanceRouterFactoryForTest } from "@/app/api/remittance/quote/route";
import {
  PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS,
  PROTECTED_TRANSFER_PLAN_MAX_BYTES,
} from "@/lib/remittance/protected-transfer";
import { USDC_COIN_TYPE_TESTNET } from "@/lib/remittance/constants";
import { normalizeSuiAddress } from "@mysten/sui/utils";

/**
 * POST /api/remittance/protected-transfer/plan — endpoint adapter tests.
 *
 * The route is a thin adapter: it byte-caps and strict-parses the top-level
 * request surface, delegates quote verification to the shared
 * `verifyRemittanceQuote` policy, resolves server-only config, computes the
 * preset deadline, and normalizes the candidate plan through the shared
 * `parseProtectedTransferExecutionPlan`. Quote, config, time-safety,
 * deadline-safety, and plan-parser policies are owned by their own modules;
 * this suite proves only adapter propagation, not re-tested policy cases.
 */

const GOLDEN_EN = "Send RM500 to Ana in Manila";
const SECRET = "a".repeat(64);
const ADDR_ANA = "0x" + "ab".repeat(32);
const PACKAGE = "0x" + "44".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const NOW = 1_700_000_000_000;

function planReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/remittance/protected-transfer/plan", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function getQuote(text: string): Promise<Record<string, unknown>> {
  const { POST } = await import("@/app/api/remittance/quote/route");
  const res = await POST(
    new Request("http://localhost/api/remittance/quote", {
      method: "POST",
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json" },
    }),
  );
  return (await res.json()) as Record<string, unknown>;
}

async function postPlan(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import("@/app/api/remittance/protected-transfer/plan/route");
  return POST(planReq(body, headers));
}

let realDateNow: () => number;

beforeEach(() => {
  realDateNow = Date.now;
  Date.now = vi.fn(() => NOW) as unknown as () => number;
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
  vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", PACKAGE);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_ADDRESS", REVIEWER);
  vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_NAME", "Convey Review Desk");
  __setGonkaRemittanceRouterFactoryForTest(null);
});

afterEach(() => {
  Date.now = realDateNow;
  __setGonkaRemittanceRouterFactoryForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/remittance/protected-transfer/plan", () => {
  it("returns one complete literal plan for the tomorrow preset, then only exact deadline plus object equality for the other presets", async () => {
    // Non-canonical env addresses prove canonicalization; padded note proves normalization.
    vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", "0x44");
    vi.stubEnv("PROTECTED_TRANSFER_REVIEWER_ADDRESS", "0x33");
    const quote = await getQuote(GOLDEN_EN);
    const note = "  School supplies  ";

    // One complete literal plan object for the tomorrow preset: every
    // authorization field and exact value spelled out, no partial assertion.
    const tomorrowRes = await postPlan({
      quote,
      deadlinePreset: "tomorrow",
      reviewNote: note,
    });
    expect(tomorrowRes.status).toBe(200);
    expect(tomorrowRes.headers.get("cache-control")).toBe("no-store");
    const tomorrow = await tomorrowRes.json();
    const expectedTomorrow = {
      kind: "protected_transfer_execution_plan",
      authorization: {
        kind: "authorization",
        recipientAddress: ADDR_ANA,
        usdcMicro: "109000000",
        coinType: USDC_COIN_TYPE_TESTNET,
        beneficiaryRef: "R-7WZ9Z9AA",
        issuedAt: NOW,
        expiresAt: NOW + 600_000,
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
      },
      packageId: normalizeSuiAddress("0x44"),
      reviewerAddress: normalizeSuiAddress("0x33"),
      reviewerName: "Convey Review Desk",
      deadlineMs: NOW + PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS.tomorrow,
      reviewNote: "School supplies",
    };
    expect(tomorrow).toEqual(expectedTomorrow);

    // The other two presets: exact deadline plus equality of the remaining
    // object (no partial "exact plan" assertion — the whole object is compared
    // against the tomorrow literal with only deadlineMs swapped).
    for (const preset of ["three_days", "seven_days"] as const) {
      const res = await postPlan({ quote, deadlinePreset: preset, reviewNote: note });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.deadlineMs).toBe(NOW + PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS[preset]);
      expect(body).toEqual({ ...expectedTomorrow, deadlineMs: body.deadlineMs });
    }
  });

  it("rejects invalid request surfaces with exact invalid_envelope and no-store (table)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    // Declared Content-Length grammar/mismatch cases are owned by the shared
    // transport helper suite; this table keeps only endpoint-specific request
    // surface failures.
    const cases: Array<[unknown, Record<string, string>]> = [
      ["not json", {}],
      [{ deadlinePreset: "tomorrow", reviewNote: "Rent" }, {}],
      [{ quote, deadlinePreset: "one_hour", reviewNote: "Rent" }, {}],
      [{ quote, deadlinePreset: "tomorrow", reviewNote: "Rent", packageId: PACKAGE }, {}],
    ];
    for (const [body, headers] of cases) {
      const res = await postPlan(body, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_envelope" });
    }
  });

  it("rejects actual streamed bytes over the cap with exact invalid_envelope and no-store", async () => {
    // Stream a body larger than the cap with no Content-Length so the reader
    // must count actual bytes and cancel mid-stream.
    const overCap = "x".repeat(PROTECTED_TRANSFER_PLAN_MAX_BYTES + 1024);
    const res = await postPlan(overCap, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_envelope" });
  });

  it("rejects an empty note with exact invalid_envelope (representative note-policy passthrough)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const res = await postPlan({ quote, deadlinePreset: "tomorrow", reviewNote: "" });
    expect(await res.json()).toEqual({ kind: "rejected", reason: "invalid_envelope" });
  });

  it("rejects as exact not_configured when the package env is missing (route-level config passthrough)", async () => {
    vi.stubEnv("PROTECTED_TRANSFER_PACKAGE_ID", "");
    const quote = await getQuote(GOLDEN_EN);
    const res = await postPlan({ quote, deadlinePreset: "tomorrow", reviewNote: "Rent" });
    expect(await res.json()).toEqual({ kind: "rejected", reason: "not_configured" });
  });

  it("passes through the exact verifier rejection for a tampered HMAC (unverified)", async () => {
    const quote = await getQuote(GOLDEN_EN);
    const tampered = { ...quote, attestation: { v: 1, hmac: "0x" + "0".repeat(64) } };
    const res = await postPlan({ quote: tampered, deadlinePreset: "tomorrow", reviewNote: "Rent" });
    expect(await res.json()).toEqual({ kind: "rejected", reason: "unverified" });
  });
});
