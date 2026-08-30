import type { Metadata } from "next";
import { PayWorkspace } from "@/components/commerce/pay-workspace";

export const metadata: Metadata = {
  title: "Pay — Convey",
  description:
    "Voice-first cross-border remittance with transparent reference fees and a guarded Sui testnet USDC transfer. Say it, review it, approve it on testnet.",
};

/**
 * The home route is the Convey Pay workspace.
 *
 * Send abroad (the default voice-first cross-border remittance money sheet)
 * dominates the first fold. Buy nearby (the existing catalog purchase flow,
 * unchanged) is reachable only through a quiet secondary link on the sheet.
 * The remittance module lives beside the commerce purchase module; neither is
 * rewritten. No new top-level route is added.
 */
export default function HomePage() {
  return <PayWorkspace />;
}
