import type { Metadata } from "next";
import { CompanionChat } from "@/components/companion/companion-chat";

export const metadata: Metadata = {
  title: "Convey",
  description:
    "A chat-first AI companion for payments, splits, receipts, and guarded treasury actions on Sui.",
};

/**
 * The home route is now the companion workspace.
 * Existing remittance and commerce routes remain intact elsewhere in the app.
 */
export default function HomePage() {
  return <CompanionChat />;
}
