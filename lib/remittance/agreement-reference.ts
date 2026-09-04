import { PROTECTED_TRANSFER_REFERENCE } from "./protected-transfer-reference";

/**
 * Public reference agreement: one real, completed 1 USDC protected transfer on
 * Sui testnet. Every identifier below already exists in source
 * (`PROTECTED_TRANSFER_REFERENCE`) or the README "Public Sui lifecycle
 * evidence" table. The Seal policy object and Walrus ciphertext coordinates
 * are recorded there and nowhere else in source, so they are pinned here with
 * that provenance rather than re-derived.
 *
 * The receipt must never claim more than these records show: the create and
 * release transactions are real; the blocked examples are contract rules that
 * no transaction exercised, so they carry no explorer link and are labelled
 * "Rule preview" and "Not submitted".
 */

export interface AgreementLink {
  label: string;
  href: string;
}

export interface AgreementFactRow {
  label: string;
  value: string;
  href?: string;
  linkLabel?: string;
}

export interface AgreementGateRow {
  gate: string;
  result: string;
  detail: string;
}

export interface AgreementSafetyRecord {
  status: "completed" | "rule-preview";
  statusLabel: string;
  headline: string;
  detail: string;
  /** Explicit truth boundary; required for every record. */
  note: string;
  links: readonly AgreementLink[];
}

const WALRUS_CIPHERTEXT_BLOB_ID = "jIrFIrjYiVZ7yrt9Gv6U5x3XawzycyykQ7NprAwapuk";
const WALRUS_CIPHERTEXT_URL = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${WALRUS_CIPHERTEXT_BLOB_ID}`;
const CIPHERTEXT_DIGEST_HEX = "0x826f4849987d384eebc8696804e4403e225f267b942a81803409eaffe2c7e52c";
const SEAL_POLICY_OBJECT_ID = "0x37acc4da1350ba4002c8b66ff76abca450aa78b377b281d0e2eefddb3cf3fa7d";
const NOT_SUBMITTED_NOTE =
  "Rule preview. Not submitted. No transaction was attempted and no gas was spent.";

export const AGREEMENT_REFERENCE = Object.freeze({
  eyebrow: "Verified example",
  title: "One protected payment, start to finish.",
  intro:
    "This page shows one real, completed agreement on the Sui test network. Every number and link below points at a public record you can open yourself.",

  outcome: Object.freeze({
    stageEyebrow: "Agreement · Released",
    amountNumber: "1",
    amountUnit: "USDC",
    beneficiary: "Ana",
    stageCaption:
      "Locked by a customer. Released by an independent reviewer. Paid in full to Ana.",
    summaryTitle: "What happened",
    summary:
      "A customer locked 1 USDC into a protected agreement for Ana's medicine pickup. A separate reviewer confirmed the request and released the full amount to Ana. The agreement is finished: the money moved once, and the payment is recorded on Sui's public test network.",
  }),

  gates: Object.freeze([
    Object.freeze({
      gate: "Terms fixed first",
      result: "Passed",
      detail:
        "Amount, recipient, purpose, reviewer, and deadline were bound together before the wallet opened.",
    }),
    Object.freeze({
      gate: "Human reviewer",
      result: "Required",
      detail:
        "Only the assigned reviewer could release the funds. The payer's approval locked the money but could never send it.",
    }),
    Object.freeze({
      gate: "Deadline",
      result: "Bound",
      detail:
        "The release window closed at a fixed time. After it, only the payer could reclaim the money.",
    }),
  ]),

  enforcement: Object.freeze({
    lead:
      "These rules are not app settings. They live in the published contract that held the money.",
    rows: Object.freeze([
      Object.freeze({
        label: "Contract package",
        value: PROTECTED_TRANSFER_REFERENCE.packageId,
        href: PROTECTED_TRANSFER_REFERENCE.packageExplorerUrl,
        linkLabel: "View package",
      }),
      Object.freeze({
        label: "Agreement object",
        value: PROTECTED_TRANSFER_REFERENCE.escrowObjectId,
      }),
      Object.freeze({
        label: "Agreement created",
        value: PROTECTED_TRANSFER_REFERENCE.createdDigest,
        href: PROTECTED_TRANSFER_REFERENCE.createdExplorerUrl,
        linkLabel: "View creation",
      }),
      Object.freeze({
        label: "Reviewer release",
        value: PROTECTED_TRANSFER_REFERENCE.releasedDigest,
        href: PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl,
        linkLabel: "View release",
      }),
      Object.freeze({
        label: "Expiry refund example",
        value: PROTECTED_TRANSFER_REFERENCE.refundedDigest,
        href: PROTECTED_TRANSFER_REFERENCE.refundedExplorerUrl,
        linkLabel: "View refund",
      }),
    ]),
    refundNote:
      "The refund is a separate, earlier agreement returned to its payer when its deadline passed. It shows the expiry path, not this payment.",
  }),

  privacy: Object.freeze({
    lead:
      "The written agreement, including the original request and its checks, is encrypted. The public chain holds only an encrypted copy and a fingerprint. Two independent key servers must agree before anyone can read the original.",
    rows: Object.freeze([
      Object.freeze({
        label: "Access policy object",
        value: SEAL_POLICY_OBJECT_ID,
      }),
      Object.freeze({
        label: "Encrypted copy",
        value: WALRUS_CIPHERTEXT_BLOB_ID,
        href: WALRUS_CIPHERTEXT_URL,
        linkLabel: "View ciphertext",
      }),
      Object.freeze({
        label: "Ciphertext fingerprint",
        value: CIPHERTEXT_DIGEST_HEX,
      }),
      Object.freeze({
        label: "Encrypted copy size",
        value: "1,740 bytes",
      }),
    ]),
  }),

  verify: Object.freeze({
    lead: "Every link below opens a public record. No wallet or account is needed.",
    links: Object.freeze([
      Object.freeze({
        label: "Contract package",
        href: PROTECTED_TRANSFER_REFERENCE.packageExplorerUrl,
      }),
      Object.freeze({
        label: "Agreement creation",
        href: PROTECTED_TRANSFER_REFERENCE.createdExplorerUrl,
      }),
      Object.freeze({
        label: "Reviewer release",
        href: PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl,
      }),
      Object.freeze({
        label: "Encrypted copy",
        href: WALRUS_CIPHERTEXT_URL,
      }),
    ]),
  }),

  safety: Object.freeze({
    eyebrow: "Safety boundaries",
    lead: "What the contract allows, and what it stops.",
    records: Object.freeze([
      Object.freeze({
        status: "completed" as const,
        statusLabel: "Completed",
        headline: "Released 1 USDC to Ana",
        detail:
          "The reviewer released the full locked amount on Sui testnet. The agreement closed and can never act again.",
        note: "Backed by the creation and release transactions linked above.",
        links: Object.freeze([
          Object.freeze({
            label: "Creation",
            href: PROTECTED_TRANSFER_REFERENCE.createdExplorerUrl,
          }),
          Object.freeze({
            label: "Release",
            href: PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl,
          }),
        ]),
      }),
      Object.freeze({
        status: "rule-preview" as const,
        statusLabel: "Rule preview",
        headline: "A payment to a different address could not go through",
        detail:
          "The release command takes no address. The contract pays the beneficiary fixed at creation, and only the reviewer can call it.",
        note: NOT_SUBMITTED_NOTE,
        links: Object.freeze([]),
      }),
      Object.freeze({
        status: "rule-preview" as const,
        statusLabel: "Rule preview",
        headline: "An amount above the agreement could not be paid",
        detail:
          "The contract pays the exact amount the payer locked, no more. A request for 15 USDC against this 1 USDC agreement is impossible on this contract.",
        note: NOT_SUBMITTED_NOTE,
        links: Object.freeze([]),
      }),
    ]),
    summary:
      "The two blocked examples describe the published contract's rules, not transactions on Sui. Convey also checks amounts, recipients, and quotes before any wallet opens. Those are product checks, and they stay separate from what the contract enforces.",
  }),
});

export type AgreementReference = typeof AGREEMENT_REFERENCE;
