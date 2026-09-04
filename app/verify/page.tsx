import type { Metadata } from "next";
import { VerificationWorkspace } from "@/components/verification/verification-workspace";

export const metadata: Metadata = {
  title: "Verify a claim | Convey",
  description:
    "Extract a claim, cross-check it with two Gonka models, and inspect the score, reasoning, evidence, and request trail.",
};

export default function VerifyPage() {
  return <VerificationWorkspace />;
}
