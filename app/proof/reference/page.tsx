import type { Metadata } from "next";
import { AgreementReferenceReceipt } from "@/components/commerce/agreement-reference-receipt";

export const metadata: Metadata = {
  title: "Verified example | Convey",
  description:
    "One real, completed protected agreement on Sui testnet: what happened, why it was allowed, and how to verify every part independently.",
};

export default function ProofReferencePage() {
  return <AgreementReferenceReceipt />;
}
