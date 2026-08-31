import { describe, expect, it } from "vitest";
import {
  formatProtectionExpiry,
  formatProtectionExpirySeconds,
  formatStrike,
  formatStrike8d,
  formatUsdcMicro,
} from "@/lib/strategy/format";

describe("strategy formatters", () => {
  it("formats USDC micro amounts and USD strikes", () => {
    expect(formatUsdcMicro("2500000")).toBe("$2.50");
    expect(formatUsdcMicro("invalid")).toBe("—");
    expect(formatStrike(4_000)).toBe("$4,000");
    expect(formatStrike8d("230000000000")).toBe("$2,300");
  });

  it("formats ISO and epoch-second expiries through the shared owner", () => {
    expect(formatProtectionExpiry("2026-08-31T00:00:00.000Z")).toBe("Aug 31, 2026");
    expect(formatProtectionExpiry("invalid")).toBe("—");
    expect(formatProtectionExpirySeconds("2100000000")).toBe(
      new Date(2_100_000_000_000).toLocaleDateString(),
    );
  });
});
