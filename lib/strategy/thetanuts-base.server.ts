import "server-only";

import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { ethers } from "ethers";
import { PROTECTION_PURCHASE_CHAIN_ID } from "@/lib/strategy/protection-purchase";

export function createBaseThetanutsClient(): ThetanutsClient {
  return new ThetanutsClient({
    chainId: PROTECTION_PURCHASE_CHAIN_ID,
    provider: new ethers.JsonRpcProvider("https://mainnet.base.org"),
  });
}

export function requireBaseOptionBook(client: ThetanutsClient): string {
  const optionBook = client.chainConfig.contracts.optionBook;
  if (!optionBook) throw new Error("Incomplete Base chain configuration.");
  return optionBook;
}
