import { describe, expect, it } from "vitest";
import { resolveProtectedTransferConfig } from "@/lib/remittance/protected-transfer-config.server";
import { normalizeSuiAddress } from "@mysten/sui/utils";

/**
 * resolveProtectedTransferConfig — exhaustive server-only config fail-closed
 * table. Missing, blank, malformed, zero, or equal package/reviewer values all
 * return not_configured. No secret or raw env value escapes; only canonical
 * addresses on success.
 */

const PACKAGE = "0x" + "44".repeat(32);
const REVIEWER = "0x" + "33".repeat(32);
const REVIEWER_NAME = "Convey Review Desk";

function env(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return {
    PROTECTED_TRANSFER_PACKAGE_ID: PACKAGE,
    PROTECTED_TRANSFER_REVIEWER_ADDRESS: REVIEWER,
    PROTECTED_TRANSFER_REVIEWER_NAME: REVIEWER_NAME,
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

describe("resolveProtectedTransferConfig", () => {
  it("returns canonical addresses for valid config", () => {
    const result = resolveProtectedTransferConfig(env({}));
    expect(result).toEqual({
      ok: true,
      config: {
        packageId: PACKAGE,
        reviewerAddress: REVIEWER,
        reviewerName: REVIEWER_NAME,
      },
    });
  });

  it("canonicalizes short-form addresses", () => {
    expect(
      resolveProtectedTransferConfig(
        env({
          PROTECTED_TRANSFER_PACKAGE_ID: "0x44",
          PROTECTED_TRANSFER_REVIEWER_ADDRESS: "0x33",
        }),
      ),
    ).toEqual({
      ok: true,
      config: {
        packageId: normalizeSuiAddress("0x44"),
        reviewerAddress: normalizeSuiAddress("0x33"),
        reviewerName: REVIEWER_NAME,
      },
    });
  });

  it.each<[string, NodeJS.ProcessEnv]>([
    ["missing package", env({ PROTECTED_TRANSFER_PACKAGE_ID: undefined })],
    ["missing reviewer", env({ PROTECTED_TRANSFER_REVIEWER_ADDRESS: undefined })],
    ["missing reviewer name", env({ PROTECTED_TRANSFER_REVIEWER_NAME: undefined })],
    ["blank package", env({ PROTECTED_TRANSFER_PACKAGE_ID: "  " })],
    ["blank reviewer", env({ PROTECTED_TRANSFER_REVIEWER_ADDRESS: "  " })],
    ["blank reviewer name", env({ PROTECTED_TRANSFER_REVIEWER_NAME: "  " })],
    ["malformed package", env({ PROTECTED_TRANSFER_PACKAGE_ID: "not-an-address" })],
    ["malformed reviewer", env({ PROTECTED_TRANSFER_REVIEWER_ADDRESS: "not-an-address" })],
    ["zero package", env({ PROTECTED_TRANSFER_PACKAGE_ID: "0x0" })],
    ["zero reviewer", env({ PROTECTED_TRANSFER_REVIEWER_ADDRESS: "0x0" })],
    ["equal package/reviewer", env({ PROTECTED_TRANSFER_REVIEWER_ADDRESS: PACKAGE })],
    ["reviewer name with control characters", env({ PROTECTED_TRANSFER_REVIEWER_NAME: "Desk\nAdmin" })],
    ["reviewer name over 80 code points", env({ PROTECTED_TRANSFER_REVIEWER_NAME: "x".repeat(81) })],
  ])("fails closed as not_configured for %s", (_label, testEnv) => {
    expect(resolveProtectedTransferConfig(testEnv)).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});
