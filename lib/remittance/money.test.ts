import { describe, expect, it } from "vitest";
import {
  formatMinor,
  formatMinorFixed,
  formatMinorFixedGrouped,
  formatMinorGrouped,
  formatMyr,
  formatMyrFixed,
  formatMyrFixedGrouped,
  formatMyrGrouped,
  formatPhp,
  formatPhpFixedGrouped,
  formatPhpGrouped,
  formatUsdc,
  formatUsdcGrouped,
  groupInteger,
} from "./money";

/**
 * Grouping display formatter tests.
 *
 * The grouping helpers are pure and locale-independent: the separator is always
 * `,` and grouping is always three-digit groups from the right, so output is
 * deterministic across runtimes. Canonical integer strings and integer
 * arithmetic are never changed — `formatMinor` (ungrouped) is preserved and the
 * grouped variants only differ in display grouping.
 */
describe("groupInteger — deterministic thousands grouping", () => {
  it("groups a plain integer from the right in 3-digit chunks", () => {
    expect(groupInteger("6104")).toBe("6,104");
    expect(groupInteger("1234567")).toBe("1,234,567");
  });

  it("does not group values with fewer than four integer digits", () => {
    expect(groupInteger("500")).toBe("500");
    expect(groupInteger("0")).toBe("0");
    expect(groupInteger("42")).toBe("42");
  });

  it("preserves the fractional part untouched", () => {
    expect(groupInteger("6104.5")).toBe("6,104.5");
    expect(groupInteger("1234567.89")).toBe("1,234,567.89");
  });

  it("preserves a leading minus sign", () => {
    expect(groupInteger("-6104")).toBe("-6,104");
    expect(groupInteger("-1234567.89")).toBe("-1,234,567.89");
  });

  it("is deterministic and never locale-dependent", () => {
    // Repeated calls produce identical output regardless of host locale.
    for (let i = 0; i < 5; i++) {
      expect(groupInteger("1000000")).toBe("1,000,000");
    }
  });
});

describe("formatMinorGrouped — grouped decimal currency formatting", () => {
  it("groups the integer part and keeps the fractional part", () => {
    // 610400 centavos / 100 = 6104.00 -> "6,104"
    expect(formatMinorGrouped("610400", 2)).toBe("6,104");
    // 610405 centavos / 100 = 6104.05 -> "6,104.05"
    expect(formatMinorGrouped("610405", 2)).toBe("6,104.05");
  });

  it("matches formatMinor when no grouping is needed", () => {
    expect(formatMinorGrouped("50000", 2)).toBe(formatMinor("50000", 2));
    expect(formatMinorGrouped("500", 2)).toBe(formatMinor("500", 2));
  });
});

describe("formatPhpGrouped — PHP centavos with grouping", () => {
  it("formats 610400 centavos as 6,104", () => {
    expect(formatPhpGrouped("610400")).toBe("6,104");
  });

  it("formats a large payout with grouping", () => {
    // 12345678 centavos = 123,456.78 PHP
    expect(formatPhpGrouped("12345678")).toBe("123,456.78");
  });

  it("does not change the canonical ungrouped formatter", () => {
    expect(formatPhp("610400")).toBe("6104");
    expect(formatPhpGrouped("610400")).toBe("6,104");
  });
});

describe("formatMyrGrouped — MYR sen with grouping", () => {
  it("formats 50000 sen as 500", () => {
    expect(formatMyrGrouped("50000")).toBe("500");
  });

  it("formats a large send amount with grouping", () => {
    // 100000 sen = 1,000 MYR
    expect(formatMyrGrouped("100000")).toBe("1,000");
    // 1234567 sen = 12,345.67 MYR
    expect(formatMyrGrouped("1234567")).toBe("12,345.67");
  });

  it("does not change the canonical ungrouped formatter", () => {
    expect(formatMyr("1234567")).toBe("12345.67");
    expect(formatMyrGrouped("1234567")).toBe("12,345.67");
  });
});

describe("formatUsdcGrouped — USDC micro with grouping", () => {
  it("formats 109000000 micro as 109", () => {
    expect(formatUsdcGrouped("109000000")).toBe("109");
  });

  it("formats a large USDC amount with grouping", () => {
    // 1,000,000,000 micro = 1,000 USDC
    expect(formatUsdcGrouped("1000000000")).toBe("1,000");
    // 1,234,567,890 micro = 1,234.56789 USDC
    expect(formatUsdcGrouped("1234567890")).toBe("1,234.56789");
  });

  it("does not change the canonical ungrouped formatter", () => {
    expect(formatUsdc("1234567890")).toBe("1234.56789");
    expect(formatUsdcGrouped("1234567890")).toBe("1,234.56789");
  });
});

describe("formatMinorFixed — exact two-decimal money typesetting", () => {
  it("preserves trailing zeros so figures never read as the ragged RM9.5", () => {
    // 950 sen = 9.50 MYR — fixed, never "9.5".
    expect(formatMinorFixed("950", 2)).toBe("9.50");
    // 49050 sen = 490.50 MYR.
    expect(formatMinorFixed("49050", 2)).toBe("490.50");
    // 50000 sen = 500.00 MYR.
    expect(formatMinorFixed("50000", 2)).toBe("500.00");
  });

  it("pads a whole amount to two decimals", () => {
    expect(formatMinorFixed("50000", 2)).toBe("500.00");
    expect(formatMinorFixed("100000", 2)).toBe("1000.00");
  });

  it("keeps non-zero fractional digits intact", () => {
    // 610405 centavos = 6104.05 PHP
    expect(formatMinorFixed("610405", 2)).toBe("6104.05");
  });
});

describe("formatMinorFixedGrouped — fixed decimals with grouping", () => {
  it("groups the integer part and keeps exactly two decimals", () => {
    expect(formatMinorFixedGrouped("610400", 2)).toBe("6,104.00");
    expect(formatMinorFixedGrouped("100000", 2)).toBe("1,000.00");
    expect(formatMinorFixedGrouped("49050", 2)).toBe("490.50");
  });
});

describe("formatMyrFixed / formatMyrFixedGrouped / formatPhpFixedGrouped", () => {
  it("formats MYR sen with exactly two decimals", () => {
    expect(formatMyrFixed("950")).toBe("9.50");
    expect(formatMyrFixed("50000")).toBe("500.00");
    expect(formatMyrFixedGrouped("950")).toBe("9.50");
    expect(formatMyrFixedGrouped("100000")).toBe("1,000.00");
  });

  it("formats PHP centavos with grouping and exactly two decimals", () => {
    expect(formatPhpFixedGrouped("610400")).toBe("6,104.00");
    expect(formatPhpFixedGrouped("12345678")).toBe("123,456.78");
  });

  it("does not change the canonical ungrouped/trailing-zero-stripping formatters", () => {
    expect(formatMyr("950")).toBe("9.5");
    expect(formatMyrFixed("950")).toBe("9.50");
    expect(formatPhp("610400")).toBe("6104");
    expect(formatPhpFixedGrouped("610400")).toBe("6,104.00");
  });
});
