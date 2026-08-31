import type { Metadata } from "next";
import { StrategyDesk } from "@/components/strategy/strategy-desk";
import { parseRemittanceContext } from "@/lib/strategy/remittance-context";

export const metadata: Metadata = {
  title: "Treasury — Convey",
  description: "Map a separate ETH or BTC treasury goal, including Purchase Power Shield preflight, without implying family-transfer protection.",
};

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const remittanceContext = parseRemittanceContext(params);
  return <StrategyDesk remittanceContext={remittanceContext} />;
}
