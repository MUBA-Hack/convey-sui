import { describe, expect, it } from "vitest";
import {
  gonkaCatalogManifestSchema,
  gonkaIntentCandidateSchema,
  gonkaIntentInputSchema,
  validateCandidateAgainstManifest,
} from "@/lib/gonka/schemas";

const VALID_CANDIDATE = {
  itemId: "iced-coffee",
  itemName: "Iced Coffee",
  merchantId: "river-cafe",
  merchantName: "River Cafe",
  quantity: 2,
  maxSpendSui: "10",
  detectedLanguage: "en",
  explanation: "User asked for two iced coffees.",
  confidence: 0.95,
};

const VALID_MANIFEST = {
  merchants: [{ id: "river-cafe", name: "River Cafe", itemIds: ["iced-coffee"] }],
  items: [{ id: "iced-coffee", name: "Iced Coffee", priceSui: "3" }],
};

describe("gonkaIntentCandidateSchema", () => {
  it("accepts a well-formed candidate", () => {
    expect(() => gonkaIntentCandidateSchema.parse(VALID_CANDIDATE)).not.toThrow();
  });

  it("rejects extra/forbidden authority fields (fail closed)", () => {
    const withAuthority = {
      ...VALID_CANDIDATE,
      recipient: "0xABC",
      transactionBytes: "deadbeef",
      digest: "xyz",
      signature: "sig",
    };
    expect(() => gonkaIntentCandidateSchema.parse(withAuthority)).toThrow();
  });

  it("rejects malformed quantity (zero, negative, non-integer, over max)", () => {
    for (const q of [0, -1, 1.5, 101]) {
      expect(() => gonkaIntentCandidateSchema.parse({ ...VALID_CANDIDATE, quantity: q })).toThrow();
    }
  });

  it("rejects confidence outside [0,1]", () => {
    expect(() => gonkaIntentCandidateSchema.parse({ ...VALID_CANDIDATE, confidence: 1.5 })).toThrow();
    expect(() => gonkaIntentCandidateSchema.parse({ ...VALID_CANDIDATE, confidence: -0.1 })).toThrow();
  });

  it("rejects empty required strings", () => {
    expect(() => gonkaIntentCandidateSchema.parse({ ...VALID_CANDIDATE, itemId: "" })).toThrow();
    expect(() => gonkaIntentCandidateSchema.parse({ ...VALID_CANDIDATE, explanation: "" })).toThrow();
  });

  it("rejects missing required keys", () => {
    const { itemId, ...rest } = VALID_CANDIDATE;
    void itemId;
    expect(() => gonkaIntentCandidateSchema.parse(rest)).toThrow();
  });
});

describe("gonkaCatalogManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    expect(() => gonkaCatalogManifestSchema.parse(VALID_MANIFEST)).not.toThrow();
  });

  it("rejects a manifest with no merchants or items", () => {
    expect(() =>
      gonkaCatalogManifestSchema.parse({ merchants: [], items: VALID_MANIFEST.items }),
    ).toThrow();
    expect(() =>
      gonkaCatalogManifestSchema.parse({ merchants: VALID_MANIFEST.merchants, items: [] }),
    ).toThrow();
  });

  it("rejects merchant with empty itemIds", () => {
    expect(() =>
      gonkaCatalogManifestSchema.parse({
        merchants: [{ id: "river-cafe", name: "River Cafe", itemIds: [] }],
        items: VALID_MANIFEST.items,
      }),
    ).toThrow();
  });
});

describe("gonkaIntentInputSchema", () => {
  it("accepts a well-formed input", () => {
    expect(() =>
      gonkaIntentInputSchema.parse({
        prompt: "buy coffee",
        localeHint: "en",
        catalog: VALID_MANIFEST,
      }),
    ).not.toThrow();
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      gonkaIntentInputSchema.parse({
        prompt: "",
        localeHint: "en",
        catalog: VALID_MANIFEST,
      }),
    ).toThrow();
  });
});

describe("validateCandidateAgainstManifest", () => {
  it("passes when ids are present and coherent", () => {
    expect(() =>
      validateCandidateAgainstManifest(VALID_CANDIDATE, VALID_MANIFEST),
    ).not.toThrow();
  });

  it("rejects an itemId absent from the manifest", () => {
    expect(() =>
      validateCandidateAgainstManifest(
        { ...VALID_CANDIDATE, itemId: "does-not-exist" },
        VALID_MANIFEST,
      ),
    ).toThrow();
  });

  it("rejects a merchantId absent from the manifest", () => {
    expect(() =>
      validateCandidateAgainstManifest(
        { ...VALID_CANDIDATE, merchantId: "ghost" },
        VALID_MANIFEST,
      ),
    ).toThrow();
  });

  it("rejects an item not sold by the matched merchant", () => {
    const manifest = {
      merchants: [
        { id: "river-cafe", name: "River Cafe", itemIds: ["latte"] },
        { id: "harbor", name: "Harbor", itemIds: ["croissant"] },
      ],
      items: [
        { id: "latte", name: "Latte", priceSui: "4" },
        { id: "croissant", name: "Croissant", priceSui: "2" },
      ],
    };
    expect(() =>
      validateCandidateAgainstManifest(
        { ...VALID_CANDIDATE, itemId: "croissant", merchantId: "river-cafe" },
        manifest,
      ),
    ).toThrow();
  });
});
