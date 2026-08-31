import { describe, expect, it } from "vitest";
import {
  createFamilyStewardManifest,
  createGonkaFamilyStewardRouter,
  familyStewardCandidateSchema,
  familyStewardInputSchema,
  resolveFamilyStewardCandidate,
  validateFamilyStewardCandidate,
  type FamilyStewardCandidate,
} from "@/lib/gonka/family-steward";
import { fakeFetch } from "./fake-fetch";

const MESSAGE = "Pay today and keep this secret 🔒";
const VALID_CANDIDATE: FamilyStewardCandidate = {
  signals: [
    { id: "urgency", text: "today", occurrence: 1 },
  ],
  questionIds: ["verify_sender_in_known_channel"],
  confidence: 0.91,
  uncertain: false,
};

describe("family steward schemas", () => {
  it("accepts a bounded prompt whose manifest is bound to the same text", () => {
    const manifest = createFamilyStewardManifest(MESSAGE);
    expect(() =>
      familyStewardInputSchema.parse({ prompt: MESSAGE, localeHint: "en", manifest }),
    ).not.toThrow();
  });

  it("rejects prompts above 500 Unicode code points", () => {
    const prompt = "🔒".repeat(501);
    expect(() => createFamilyStewardManifest(prompt)).toThrow();
  });

  it("rejects extra keys, duplicate signals, and duplicate questions", () => {
    expect(() =>
      familyStewardCandidateSchema.parse({ ...VALID_CANDIDATE, explanation: "trust me" }),
    ).toThrow();
    expect(() =>
      familyStewardCandidateSchema.parse({
        ...VALID_CANDIDATE,
        signals: [
          {
            id: "urgency",
            text: "today",
            occurrence: 1,
            start: 4,
            end: 9,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      familyStewardCandidateSchema.parse({
        ...VALID_CANDIDATE,
        signals: [{ id: "urgency", text: "today", occurrence: 21 }],
      }),
    ).toThrow();
    expect(() =>
      familyStewardCandidateSchema.parse({
        ...VALID_CANDIDATE,
        signals: [VALID_CANDIDATE.signals[0], VALID_CANDIDATE.signals[0]],
      }),
    ).toThrow();
    expect(() =>
      familyStewardCandidateSchema.parse({
        ...VALID_CANDIDATE,
        questionIds: [
          "verify_sender_in_known_channel",
          "verify_sender_in_known_channel",
        ],
      }),
    ).toThrow();
  });
});

describe("validateFamilyStewardCandidate", () => {
  it("resolves exact evidence after emoji and combining characters to code-point offsets", () => {
    const message = "🔒 Baye\u0301r: keep this secret";
    const candidate: FamilyStewardCandidate = {
      ...VALID_CANDIDATE,
      signals: [{ id: "secrecy", text: "secret", occurrence: 1 }],
    };
    const resolved = resolveFamilyStewardCandidate(candidate, message);
    const utf16Start = message.indexOf("secret");
    const codePointStart = Array.from(message.slice(0, utf16Start)).length;

    expect(resolved.signals).toEqual([
      {
        id: "secrecy",
        start: codePointStart,
        end: codePointStart + Array.from("secret").length,
        text: "secret",
      },
    ]);
    expect(codePointStart).not.toBe(utf16Start);
  });

  it("uses the bounded occurrence selector to resolve repeated exact evidence", () => {
    const message = "pay now, then pay now";
    const candidate: FamilyStewardCandidate = {
      ...VALID_CANDIDATE,
      signals: [{ id: "urgency", text: "pay now", occurrence: 2 }],
    };
    const resolved = resolveFamilyStewardCandidate(candidate, message);
    const secondStart = Array.from("pay now, then ").length;

    expect(resolved.signals[0]).toEqual({
      id: "urgency",
      start: secondStart,
      end: secondStart + Array.from("pay now").length,
      text: "pay now",
    });
  });

  it("rejects nonexistent evidence and an occurrence beyond the exact matches", () => {
    expect(() =>
      validateFamilyStewardCandidate(
        {
          ...VALID_CANDIDATE,
          signals: [{ id: "urgency", text: "tomorrow", occurrence: 1 }],
        },
        MESSAGE,
      ),
    ).toThrow(/not found/i);
    expect(() =>
      validateFamilyStewardCandidate(
        {
          ...VALID_CANDIDATE,
          signals: [{ id: "urgency", text: "Pay", occurrence: 2 }],
        },
        MESSAGE,
      ),
    ).toThrow(/occurrence/i);
  });
});

describe("createGonkaFamilyStewardRouter", () => {
  it("returns exact evidence while sending no quote or payment authority", async () => {
    const provider = fakeFetch([
      {
        kind: "ok",
        body: JSON.stringify(VALID_CANDIDATE),
        requestId: "request-a",
        model: "model-a",
      },
    ]);
    const router = createGonkaFamilyStewardRouter(
      { apiKey: "test-key", modelId: "model-a", maxRetries: 0 },
      {
        fetch: provider.fetch as unknown as typeof fetch,
        now: () => 1_700_000_000_000,
      },
    );

    const result = await router.run({
      prompt: MESSAGE,
      localeHint: "en",
      manifest: createFamilyStewardManifest(MESSAGE),
    });

    expect(result.type).toBe("gonka-run-ok");
    expect(JSON.stringify(provider.calls[0]?.body)).not.toMatch(
      /quote|walletAddress|attestation|digest|transactionBytes/i,
    );
  });
});
