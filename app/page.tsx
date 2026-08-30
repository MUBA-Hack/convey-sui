import type { Metadata } from "next";
import { PayWorkspace } from "@/components/commerce/pay-workspace";

export const metadata: Metadata = {
  title: "Pay — Convey",
  description:
    "Voice-first cross-border remittance with transparent fees and Sui USDC settlement. Say it, approve it, settle on Sui.",
};

/**
 * The home route is the Convey Pay workspace.
 *
 * A thin mode switch lets the customer choose "Send abroad" (default —
 * voice-first cross-border remittance) or "Buy nearby" (the existing catalog
 * purchase flow, unchanged). The remittance module lives beside the commerce
 * purchase module; neither is rewritten. No new top-level route is added.
 */
export default function HomePage() {
  return <PayWorkspace />;
}
