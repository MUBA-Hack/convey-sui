import type { Metadata } from "next";
import { ProofVerifier } from "@/components/commerce/proof-verifier";

export const metadata: Metadata = {
  title: "Receipts — Convey",
  description: "Open a Convey receipt, review what happened, and inspect its supporting evidence when needed.",
};

export default function ProofPage() {
  return <ProofVerifier />;
}
