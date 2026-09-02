import { describe, expect, it } from "vitest";
import { formatMicroAmount } from "@/components/companion/overnight-protection-card";

describe("formatMicroAmount", () => {
  it("formats bounded policy values as consumer amounts", () => {
    expect(formatMicroAmount("25000000")).toBe("25");
    expect(formatMicroAmount("1250000")).toBe("1.25");
  });
});
