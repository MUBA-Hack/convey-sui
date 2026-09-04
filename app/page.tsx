import type { Metadata } from "next";
import { ConveyLanding } from "@/components/landing/convey-landing";

export const metadata: Metadata = {
  title: "Convey: money that understands the assignment",
  description:
    "A chat-first AI companion for enforceable payments, independent verification, group approvals, QR exchange, and guarded treasury actions.",
};

export default function HomePage() {
  return <ConveyLanding />;
}
