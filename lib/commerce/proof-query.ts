import { PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM } from "@/lib/remittance/protected-transfer-created-receipt";
import { PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM } from "@/lib/remittance/protected-transfer-terminal-receipt";
import { PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM } from "@/lib/strategy/protection-purchase-receipt";

export const PROOF_RECEIPT_QUERY_PARAMS = [
  "r",
  "p",
  PROTECTED_TRANSFER_CREATED_RECEIPT_QUERY_PARAM,
  PROTECTED_TRANSFER_TERMINAL_RECEIPT_QUERY_PARAM,
  PROTECTION_PURCHASE_RECEIPT_QUERY_PARAM,
] as const;

export type ProofReceiptQueryParam = (typeof PROOF_RECEIPT_QUERY_PARAMS)[number];

export function isProofReceiptQueryParam(value: string): value is ProofReceiptQueryParam {
  return PROOF_RECEIPT_QUERY_PARAMS.some((candidate) => candidate === value);
}
