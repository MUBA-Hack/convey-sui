import type { Metadata } from "next";
import { ProofVerifier } from "@/components/commerce/proof-verifier";

export const metadata: Metadata = {
  title: "Activity — Convey",
  description:
    "Review recent transfers on this device, or open a Convey receipt to inspect what happened.",
};

export default function ProofPage() {
  return <ProofVerifier />;
}
