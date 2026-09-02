import type { Metadata } from "next";
import { CompanionChat } from "@/components/companion/companion-chat";
import { CompanionShowcase } from "@/components/companion/companion-showcase";
import { SAMPLE_COMPANION_MEMORY } from "@/components/companion/sample-context";

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
  return (
    <main>
      <CompanionChat initialMemory={SAMPLE_COMPANION_MEMORY} memoryMode="sample" />
      <CompanionShowcase />
    </main>
  );
}
