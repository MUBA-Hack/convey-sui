import type { Metadata } from "next";
import { ProofVerifier } from "@/components/commerce/proof-verifier";

export const metadata: Metadata = {
  title: "Verify — Convey",
  description: "Inspect a portable Convey receipt locally with strict, mode-aware validation and an explicit evidence boundary.",
};

export default function ProofPage() {
  return <ProofVerifier />;
}
