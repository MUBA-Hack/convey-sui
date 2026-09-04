import { describe, expect, it } from "vitest";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { PROTECTED_TRANSFER_REFERENCE as reference } from "@/lib/remittance/protected-transfer-reference";

describe("published Protected Transfer reference", () => {
  it("pins canonical public Sui coordinates and an exact amount", () => {
    expect(isValidSuiAddress(reference.packageId)).toBe(true);
    expect(isValidSuiAddress(reference.escrowObjectId)).toBe(true);
    expect(isValidSuiAddress(reference.beneficiaryAddress)).toBe(true);
    expect(isValidSuiAddress(reference.reviewerAddress)).toBe(true);
    expect(reference.asset).toBe("USDC");
    expect(reference.amountMicro).toBe("1000000");
    expect(reference.amountDisplay).toBe("1 USDC");
    expect(reference.beneficiaryAddress).toBe("0x705c6669bbf247264d7344fead9a8371fbf6aa818379fc84a4ba2538578a587b");
    expect(reference.createdDigest).toBe("BWiZmTbtNU6Tm9g3SDNrD6RbmxHsTyjgmssqJxamRM4P");
    expect(reference.releasedDigest).toBe("HUcinKrEMfwcSf3XRcyWabRFWYroXrVdg6umdZChPgcV");
  });

  it("binds explorer links to the exact public digests", () => {
    expect(reference.createdExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.createdDigest}`);
    expect(reference.releasedExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.releasedDigest}`);
    expect(reference.refundedExplorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${reference.refundedDigest}`);
    expect(reference.packageExplorerUrl).toBe(`https://suiscan.xyz/testnet/object/${reference.packageId}`);
  });
});
