import type { Metadata } from "next";
import { StrategyDesk } from "@/components/strategy/strategy-desk";
import { parseRemittanceContext } from "@/lib/strategy/remittance-context";

export const metadata: Metadata = {
  title: "Protect — Convey",
  description: "Describe a downside-protection goal and see a tailored strategy preview beside live Base market context.",
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
