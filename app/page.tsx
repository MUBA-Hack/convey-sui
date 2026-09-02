import type { Metadata } from "next";
import { ConveyLanding } from "@/components/landing/convey-landing";

export const metadata: Metadata = {
  title: "Convey: money that understands the assignment",
  description:
    "A chat-first AI companion for payments, splits, receipts, and guarded treasury actions on Sui.",
};

export default function HomePage() {
  return <ConveyLanding />;
}
