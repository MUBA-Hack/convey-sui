import type { Metadata } from "next";
import { CompanionChat } from "@/components/companion/companion-chat";
import { SAMPLE_COMPANION_MEMORY } from "@/components/companion/sample-context";

export const metadata: Metadata = {
  title: "Assistant · Convey",
  description: "Talk to Convey to pay, split, collect, and protect your money.",
};

export default function CompanionAppPage() {
  return <CompanionChat initialMemory={SAMPLE_COMPANION_MEMORY} memoryMode="sample" variant="app" />;
}
