import { describe, expect, it } from "vitest";
import { parseRemittanceContext } from "@/lib/strategy/remittance-context";

describe("parseRemittanceContext", () => {
  it("parses a valid remittance deep-link context", () => {
    const ctx = parseRemittanceContext({
      source: "remittance",
      amountMyr: "500",
      recipient: "Ana",
      city: "Manila",
    });
    expect(ctx).toEqual({
      source: "remittance",
      amountMyr: 500,
      recipient: "Ana",
      city: "Manila",
    });
  });

  it("returns null when source is not remittance", () => {
    expect(
      parseRemittanceContext({
        source: "other",
        amountMyr: "500",
        recipient: "Ana",
        city: "Manila",
      }),
    ).toBeNull();
    expect(
      parseRemittanceContext({ amountMyr: "500", recipient: "Ana", city: "Manila" }),
    ).toBeNull();
  });

  it("returns null when any required field is missing", () => {
    expect(
      parseRemittanceContext({ source: "remittance", recipient: "Ana", city: "Manila" }),
    ).toBeNull();
    expect(
      parseRemittanceContext({ source: "remittance", amountMyr: "500", city: "Manila" }),
    ).toBeNull();
    expect(
      parseRemittanceContext({ source: "remittance", amountMyr: "500", recipient: "Ana" }),
    ).toBeNull();
  });

  it("returns null for a non-numeric amount", () => {
    expect(
      parseRemittanceContext({
        source: "remittance",
        amountMyr: "abc",
        recipient: "Ana",
        city: "Manila",
      }),
    ).toBeNull();
  });

  it("clamps the amount to the strategy notional bounds", () => {
    const tooSmall = parseRemittanceContext({
      source: "remittance",
      amountMyr: "0",
      recipient: "Ana",
      city: "Manila",
    });
    expect(tooSmall).toBeNull(); // <= 0 is invalid, not clamped
    const huge = parseRemittanceContext({
      source: "remittance",
      amountMyr: "99999999",
      recipient: "Ana",
      city: "Manila",
    });
    expect(huge?.amountMyr).toBe(1_000_000);
  });

  it("strips control characters and angle brackets from display strings", () => {
    const ctx = parseRemittanceContext({
      source: "remittance",
      amountMyr: "500",
      recipient: "An<script>a</script>",
      city: "Man<ila>",
    });
    // Angle brackets are stripped; inner text remains (display-only, escaped by React).
    expect(ctx?.recipient).toBe("Anscripta/script");
    expect(ctx?.city).toBe("Manila");
  });

  it("truncates over-long display strings", () => {
    const longName = "A".repeat(60);
    const ctx = parseRemittanceContext({
      source: "remittance",
      amountMyr: "500",
      recipient: longName,
      city: "Manila",
    });
    expect(ctx?.recipient.length).toBe(40);
  });

  it("accepts array-valued params (first value wins)", () => {
    const ctx = parseRemittanceContext({
      source: ["remittance"],
      amountMyr: ["500", "999"],
      recipient: ["Ana"],
      city: ["Manila"],
    });
    expect(ctx).toEqual({
      source: "remittance",
      amountMyr: 500,
      recipient: "Ana",
      city: "Manila",
    });
  });
});
