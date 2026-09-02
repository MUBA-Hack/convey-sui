import { describe, expect, it } from "vitest";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { PROTECTED_TRANSFER_REFERENCE as reference } from "@/lib/remittance/protected-transfer-reference";

describe("published Protected Transfer reference", () => {
  it("pins canonical public Sui coordinates and an exact amount", () => {
    expect(isValidSuiAddress(reference.packageId)).toBe(true);
    expect(isValidSuiAddress(reference.escrowObjectId)).toBe(true);
    expect(isValidSuiAddress(reference.beneficiaryAddress)).toBe(true);
    expect(isValidSuiAddress(reference.reviewerAddress)).toBe(true);
    expect(reference.amountMist).toBe("10000000");
    expect(reference.amountDisplay).toBe("0.01 SUI");
  });

  it("binds explorer links to the exact public digests", () => {
    expect(reference.createdExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.createdDigest}`);
    expect(reference.releasedExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.releasedDigest}`);
    expect(reference.refundedExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.refundedDigest}`);
    expect(reference.packageExplorerUrl).toBe(`https://suiscan.xyz/testnet/object/${reference.packageId}`);
  });
});
