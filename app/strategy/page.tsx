import type { Metadata } from "next";
import { StrategyDesk } from "@/components/strategy/strategy-desk";

export const metadata: Metadata = {
  title: "Protect — Convey",
  description: "A read-only educational options strategy mapper with live Base market context from the Thetanuts Finance SDK.",
};

export default function StrategyPage() {
  return <StrategyDesk />;
}
