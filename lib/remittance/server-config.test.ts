import { describe, expect, it } from "vitest";
import { resolveRemittanceConfig, resolveRecipientForAlias, validateConfig } from "./server-config";
import { DEFAULT_CONFIG } from "./constants";

const KEY = "a".repeat(64);
const ADDR_A = "0x" + "ab".repeat(32);
const ADDR_B = "0x" + "cd".repeat(32);

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("resolveRemittanceConfig — signing key", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    const cfg = resolveRemittanceConfig(env({ REMITTANCE_QUOTE_SIGNING_KEY_HEX: KEY }));
    expect(cfg.quoteSigningKeyHex).toBe(KEY);
  });

  it("fails closed on weak/short keys", () => {
    expect(
      resolveRemittanceConfig(env({ REMITTANCE_QUOTE_SIGNING_KEY_HEX: "short" })).quoteSigningKeyHex,
    ).toBeNull();
  });

  it("fails closed on non-hex keys", () => {
    expect(
      resolveRemittanceConfig(env({ REMITTANCE_QUOTE_SIGNING_KEY_HEX: "g".repeat(64) }))
        .quoteSigningKeyHex,
    ).toBeNull();
  });

  it("fails closed when unset", () => {
    expect(resolveRemittanceConfig(env()).quoteSigningKeyHex).toBeNull();
  });
});

describe("resolveRemittanceConfig — unique deposit addresses", () => {
  it("maps unique aliases to canonical addresses", () => {
    const cfg = resolveRemittanceConfig(
      env({
        REMITTANCE_RECIPIENTS_JSON: JSON.stringify({ ana: ADDR_A, maria: ADDR_B }),
      }),
    );
    expect(resolveRecipientForAlias(cfg.recipients, "Ana")).toBe(ADDR_A);
    expect(resolveRecipientForAlias(cfg.recipients, "maria")).toBe(ADDR_B);
  });

  it("drops the entire mapping when two aliases share a deposit address", () => {
    const cfg = resolveRemittanceConfig(
      env({
        REMITTANCE_RECIPIENTS_JSON: JSON.stringify({ ana: ADDR_A, twin: ADDR_A }),
      }),
    );
    expect(cfg.recipients.size).toBe(0);
    expect(resolveRecipientForAlias(cfg.recipients, "ana")).toBeNull();
  });

  it("normalizes addresses before uniqueness checks", () => {
    const mixedCase = "0x" + "AB".repeat(32);
    const cfg = resolveRemittanceConfig(
      env({
        REMITTANCE_RECIPIENTS_JSON: JSON.stringify({ ana: mixedCase, twin: ADDR_A }),
      }),
    );
    // mixedCase lowercases to ADDR_A, so both collide.
    expect(cfg.recipients.size).toBe(0);
  });
});

describe("validateConfig", () => {
  it("accepts defaults with empty recipients/key", () => {
    expect(
      validateConfig({
        ...DEFAULT_CONFIG,
        quoteSigningKeyHex: null,
        recipients: new Map(),
      }),
    ).toBeNull();
  });
});
