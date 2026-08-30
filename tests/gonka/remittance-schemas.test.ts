import { describe, expect, it } from "vitest";
import {
  gonkaRemittanceManifestSchema,
  gonkaRemittanceInputSchema,
  gonkaRemittanceCandidateSchema,
  validateRemittanceCandidateAgainstManifest,
  type GonkaRemittanceManifest,
  type GonkaRemittanceCandidate,
} from "@/lib/gonka/remittance";

const VALID_RECIPIENT = {
  alias: "Ana",
  destinationCities: ["Manila"],
  destinationCountry: "Philippines",
};

const VALID_MANIFEST: GonkaRemittanceManifest = {
  recipients: [VALID_RECIPIENT],
  corridor: {
    source: "MYR",
    destination: "PHP",
    destinationCountry: "Philippines",
    destinationCities: ["manila", "cebu"],
  },
};

const VALID_INPUT = {
  prompt: "Hantar RM500 to Ana for school supplies; jangan lebih RM520.",
  localeHint: "ms",
  manifest: VALID_MANIFEST,
};

const VALID_CANDIDATE: GonkaRemittanceCandidate = {
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

describe("gonkaRemittanceManifestSchema — no addresses or private references", () => {
  it("accepts a well-formed public manifest", () => {
    expect(() => gonkaRemittanceManifestSchema.parse(VALID_MANIFEST)).not.toThrow();
  });

  it("rejects a recipient that smuggles a wallet address", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({
        ...VALID_MANIFEST,
        recipients: [{ ...VALID_RECIPIENT, walletAddress: "0xabc" }],
      }),
    ).toThrow();
  });

  it("rejects a recipient that smuggles a private account reference", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({
        ...VALID_MANIFEST,
        recipients: [{ ...VALID_RECIPIENT, accountRef: "PH-BPI-1234" }],
      }),
    ).toThrow();
  });

  it("rejects a manifest with no recipients", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({ ...VALID_MANIFEST, recipients: [] }),
    ).toThrow();
  });

  it("rejects case-insensitive duplicate recipient aliases", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({
        ...VALID_MANIFEST,
        recipients: [
          { ...VALID_RECIPIENT, alias: "Ana" },
          { ...VALID_RECIPIENT, alias: "ana" },
        ],
      }),
    ).toThrow();
  });

  it("rejects case-insensitive duplicate destination cities within a recipient", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({
        ...VALID_MANIFEST,
        recipients: [
          { ...VALID_RECIPIENT, destinationCities: ["Manila", "manila"] },
        ],
      }),
    ).toThrow();
  });

  it("rejects case-insensitive duplicate corridor destination cities", () => {
    expect(() =>
      gonkaRemittanceManifestSchema.parse({
        ...VALID_MANIFEST,
        corridor: {
          source: "MYR",
          destination: "PHP",
          destinationCountry: "Philippines",
          destinationCities: ["Manila", "manila"],
        },
      }),
    ).toThrow();
  });
});

describe("gonkaRemittanceInputSchema", () => {
  it("accepts a well-formed input", () => {
    expect(() => gonkaRemittanceInputSchema.parse(VALID_INPUT)).not.toThrow();
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      gonkaRemittanceInputSchema.parse({ ...VALID_INPUT, prompt: "" }),
    ).toThrow();
  });
});

describe("gonkaRemittanceCandidateSchema — exact keys, no authority", () => {
  it("accepts a well-formed candidate", () => {
    expect(() => gonkaRemittanceCandidateSchema.parse(VALID_CANDIDATE)).not.toThrow();
  });

  it("accepts a candidate without optional purpose and max cap", () => {
    const { purpose, maxAmountMyr, ...rest } = VALID_CANDIDATE;
    void purpose;
    void maxAmountMyr;
    expect(() => gonkaRemittanceCandidateSchema.parse(rest)).not.toThrow();
  });

  it("rejects forbidden authority fields (wallet, transaction bytes, digest, signature)", () => {
    for (const extra of [
      { walletAddress: "0xabc" },
      { recipientAddress: "0xabc" },
      { transactionBytes: "deadbeef" },
      { digest: "xyz" },
      { signature: "sig" },
    ]) {
      expect(() =>
        gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, ...extra }),
      ).toThrow();
    }
  });

  it("rejects a missing required key", () => {
    const { recipientAlias, ...rest } = VALID_CANDIDATE;
    void recipientAlias;
    expect(() => gonkaRemittanceCandidateSchema.parse(rest)).toThrow();
  });

  it("rejects a non-decimal sendAmountMyr", () => {
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "five" }),
    ).toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "500.123" }),
    ).toThrow();
  });

  it("rejects leading-zero amount variants (0500) while allowing canonical values", () => {
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "0500" }),
    ).toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "00" }),
    ).toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, maxAmountMyr: "0520" }),
    ).toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "500" }),
    ).not.toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "0" }),
    ).not.toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, sendAmountMyr: "0.50" }),
    ).not.toThrow();
  });

  it("rejects confidence outside [0,1]", () => {
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, confidence: 1.5 }),
    ).toThrow();
    expect(() =>
      gonkaRemittanceCandidateSchema.parse({ ...VALID_CANDIDATE, confidence: -0.1 }),
    ).toThrow();
  });

  it("requires explicit uncertain and needsReview booleans", () => {
    const { uncertain, ...rest } = VALID_CANDIDATE;
    void uncertain;
    expect(() => gonkaRemittanceCandidateSchema.parse(rest)).toThrow();
  });
});

describe("validateRemittanceCandidateAgainstManifest", () => {
  it("passes when alias, city, and country are present and coherent", () => {
    expect(() =>
      validateRemittanceCandidateAgainstManifest(VALID_CANDIDATE, VALID_MANIFEST),
    ).not.toThrow();
  });

  it("rejects an alias absent from the manifest", () => {
    expect(() =>
      validateRemittanceCandidateAgainstManifest(
        { ...VALID_CANDIDATE, recipientAlias: "Ghost" },
        VALID_MANIFEST,
      ),
    ).toThrow();
  });

  it("rejects a city not listed for the recipient", () => {
    expect(() =>
      validateRemittanceCandidateAgainstManifest(
        { ...VALID_CANDIDATE, destinationCity: "Cebu" },
        VALID_MANIFEST,
      ),
    ).toThrow();
  });

  it("rejects a city outside the supported corridor", () => {
    const manifest = {
      recipients: [{ ...VALID_RECIPIENT, destinationCities: ["Tokyo"] }],
      corridor: {
        source: "MYR" as const,
        destination: "PHP" as const,
        destinationCountry: "Philippines" as const,
        destinationCities: ["manila", "cebu"],
      },
    };
    expect(() =>
      validateRemittanceCandidateAgainstManifest(
        { ...VALID_CANDIDATE, destinationCity: "Tokyo" },
        manifest,
      ),
    ).toThrow();
  });

  it("rejects a country that does not match the corridor", () => {
    expect(() =>
      validateRemittanceCandidateAgainstManifest(
        { ...VALID_CANDIDATE, destinationCountry: "Japan" },
        VALID_MANIFEST,
      ),
    ).toThrow();
  });
});
