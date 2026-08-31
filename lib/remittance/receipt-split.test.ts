import { describe, expect, it } from "vitest";
import {
  SPLIT_MAX_PARTICIPANTS,
  SPLIT_MIN_PARTICIPANTS,
  SPLIT_NAME_MAX,
  USDC_DECIMALS,
  equalSplit,
  formatSplitRequest,
  normalizeSplitName,
  parseUsdcDecimalToMicro,
  sumAllocationsMicro,
  validateAllocationMicro,
  validateSplitName,
  validateSplitTotal,
} from "./receipt-split";

describe("normalizeSplitName", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeSplitName("  Ana  ")).toBe("Ana");
  });
  it("collapses internal whitespace runs to single spaces", () => {
    expect(normalizeSplitName("Ana   Marie\t Lopez")).toBe("Ana Marie Lopez");
  });
  it("returns empty string for whitespace-only input", () => {
    expect(normalizeSplitName("   \t ")).toBe("");
  });
});

describe("validateSplitName", () => {
  it("rejects blank names", () => {
    expect(validateSplitName("", [])).toBe("blank");
    expect(validateSplitName("   ", [])).toBe("blank");
  });
  it("rejects names longer than the bound after normalization", () => {
    const long = "a".repeat(SPLIT_NAME_MAX + 1);
    expect(validateSplitName(long, [])).toBe("too_long");
  });
  it("accepts a name at the exact max length", () => {
    const max = "a".repeat(SPLIT_NAME_MAX);
    expect(validateSplitName(max, [])).toBeNull();
  });
  it("rejects duplicates case-insensitively against normalized others", () => {
    expect(validateSplitName("Ana", ["Ana"])).toBe("duplicate");
    expect(validateSplitName("ana", ["Ana"])).toBe("duplicate");
    expect(validateSplitName(" ANA ", ["Ana"])).toBe("duplicate");
  });
  it("accepts a distinct name", () => {
    expect(validateSplitName("Marie", ["Ana"])).toBeNull();
  });
});

describe("equalSplit", () => {
  it("distributes remainder to earliest participants (100 / 3 => 34/33/33)", () => {
    expect(equalSplit("100", 3)).toEqual(["34", "33", "33"]);
  });
  it("sums exactly to the source total", () => {
    const parts = equalSplit("100", 3);
    expect(parts.reduce((a, b) => a + BigInt(b), 0n)).toBe(100n);
  });
  it("splits evenly when no remainder (100 / 2 => 50/50)", () => {
    expect(equalSplit("100", 2)).toEqual(["50", "50"]);
  });
  it("distributes remainder across the first rows (100 / 8)", () => {
    expect(equalSplit("100", 8)).toEqual([
      "13", "13", "13", "13", "12", "12", "12", "12",
    ]);
    const parts = equalSplit("100", 8);
    expect(parts.reduce((a, b) => a + BigInt(b), 0n)).toBe(100n);
  });
  it("handles a remainder of one (7 / 3 => 3/2/2)", () => {
    expect(equalSplit("7", 3)).toEqual(["3", "2", "2"]);
  });
  it("is deterministic for the same inputs", () => {
    expect(equalSplit("100000001", 7)).toEqual(equalSplit("100000001", 7));
  });
  it("rejects counts below the minimum", () => {
    expect(() => equalSplit("100", SPLIT_MIN_PARTICIPANTS - 1)).toThrow(RangeError);
  });
  it("rejects counts above the maximum", () => {
    expect(() => equalSplit("100", SPLIT_MAX_PARTICIPANTS + 1)).toThrow(RangeError);
  });
  it("rejects a zero total", () => {
    expect(() => equalSplit("0", 3)).toThrow(RangeError);
  });
  it("rejects a malformed total", () => {
    expect(() => equalSplit("abc", 3)).toThrow(RangeError);
  });
});

describe("parseUsdcDecimalToMicro", () => {
  it("parses a whole USDC amount to micro", () => {
    expect(parseUsdcDecimalToMicro("109")).toEqual({ ok: true, micro: "109000000" });
  });
  it("parses a fractional USDC amount to micro", () => {
    expect(parseUsdcDecimalToMicro("0.000034")).toEqual({ ok: true, micro: "34" });
  });
  it("parses a leading-dot fraction", () => {
    expect(parseUsdcDecimalToMicro(".5")).toEqual({ ok: true, micro: "500000" });
  });
  it("pads short fractional parts to six decimals", () => {
    expect(parseUsdcDecimalToMicro("1.2")).toEqual({ ok: true, micro: "1200000" });
  });
  it("rejects more than six decimals as too_many_decimals", () => {
    expect(parseUsdcDecimalToMicro("0.0000001")).toEqual({ ok: false, error: "too_many_decimals" });
  });
  it("rejects non-numeric input as malformed", () => {
    expect(parseUsdcDecimalToMicro("abc")).toEqual({ ok: false, error: "malformed" });
  });
  it("rejects empty input as malformed", () => {
    expect(parseUsdcDecimalToMicro("")).toEqual({ ok: false, error: "malformed" });
  });
  it("rejects negative input as malformed", () => {
    expect(parseUsdcDecimalToMicro("-1")).toEqual({ ok: false, error: "malformed" });
  });
  it("rejects a trailing dot with no fractional digits as malformed", () => {
    expect(parseUsdcDecimalToMicro("1.")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("validateAllocationMicro", () => {
  it("rejects zero as not_positive", () => {
    expect(validateAllocationMicro("0", "100")).toBe("not_positive");
  });
  it("rejects an allocation exceeding the total as overflow", () => {
    expect(validateAllocationMicro("101", "100")).toBe("overflow");
  });
  it("accepts a positive allocation within the total", () => {
    expect(validateAllocationMicro("34", "100")).toBeNull();
  });
  it("accepts an allocation equal to the total", () => {
    expect(validateAllocationMicro("100", "100")).toBeNull();
  });
  it("rejects a malformed micro string", () => {
    expect(validateAllocationMicro("abc", "100")).toBe("malformed");
  });
});

describe("sumAllocationsMicro + validateSplitTotal", () => {
  it("sums allocations exactly", () => {
    expect(sumAllocationsMicro(["34", "33", "33"])).toBe("100");
  });
  it("validates an exact total", () => {
    expect(validateSplitTotal(["34", "33", "33"], "100")).toBe(true);
  });
  it("rejects an over-total split", () => {
    expect(validateSplitTotal(["34", "33", "34"], "100")).toBe(false);
  });
  it("rejects an under-total split", () => {
    expect(validateSplitTotal(["34", "33"], "100")).toBe(false);
  });
  it("rejects a malformed allocation in the sum", () => {
    expect(validateSplitTotal(["34", "abc", "33"], "100")).toBe(false);
  });
});

describe("formatSplitRequest", () => {
  it("includes name, exact USDC amount, receipt reference, and request language", () => {
    const out = formatSplitRequest({
      participantName: "Ana",
      usdcMicro: "34",
      receiptRef: "https://example.test/proof?r=abc",
    });
    expect(out).toBe(
      "Split request for Ana: 0.000034 USDC\n" +
        "Receipt: https://example.test/proof?r=abc\n" +
        "This is a request, not a payment.",
    );
  });
  it("round-trips the exact micro amount through the formatted USDC decimal", () => {
    const out = formatSplitRequest({
      participantName: "Marie",
      usdcMicro: "109000000",
      receiptRef: "ref-123",
    });
    const amountLine = out.split("\n")[0]!;
    const decimal = amountLine.match(/:\s([\d.]+)\sUSDC/)?.[1];
    expect(decimal).toBe("109");
    const parsed = parseUsdcDecimalToMicro(decimal!);
    expect(parsed).toEqual({ ok: true, micro: "109000000" });
  });
  it("uses the configured USDC decimals constant", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
  it("never uses paid language", () => {
    const out = formatSplitRequest({
      participantName: "Ana",
      usdcMicro: "34",
      receiptRef: "ref",
    });
    expect(out).not.toMatch(/paid/i);
    expect(out).toMatch(/request/i);
  });
});
