// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AgreementReferenceReceipt } from "@/components/commerce/agreement-reference-receipt";
import { AGREEMENT_REFERENCE } from "@/lib/remittance/agreement-reference";
import { PROTECTED_TRANSFER_REFERENCE } from "@/lib/remittance/protected-transfer-reference";

/**
 * The public reference receipt may only restate identifiers that already exist
 * in source or README, may only link the pinned public URLs, and must never
 * dress the rule-preview examples up as on-chain refusals.
 */

const PINNED_HREFS = new Set<string>([
  PROTECTED_TRANSFER_REFERENCE.packageExplorerUrl,
  PROTECTED_TRANSFER_REFERENCE.createdExplorerUrl,
  PROTECTED_TRANSFER_REFERENCE.releasedExplorerUrl,
  PROTECTED_TRANSFER_REFERENCE.refundedExplorerUrl,
  "https://aggregator.walrus-testnet.walrus.space/v1/blobs/jIrFIrjYiVZ7yrt9Gv6U5x3XawzycyykQ7NprAwapuk",
]);

afterEach(() => {
  cleanup();
});

describe("AgreementReferenceReceipt — public verified example", () => {
  it("renders the outcome first with the exact real amount and beneficiary", () => {
    render(<AgreementReferenceReceipt />);
    expect(screen.getByTestId("agreement-outcome-stage")).toHaveTextContent(/1\s*USDC/);
    expect(screen.getByTestId("agreement-outcome-stage")).toHaveTextContent(
      "Released by an independent reviewer",
    );
    expect(screen.getByTestId("agreement-summary")).toHaveTextContent(/Ana/);
  });

  it("links only the pinned public records and nothing else", () => {
    render(<AgreementReferenceReceipt />);
    fireEvent.click(screen.getByTestId("agreement-privacy-trigger"));
    fireEvent.click(screen.getByTestId("agreement-verify-trigger"));
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(PINNED_HREFS.has(href ?? ""), `unexpected href ${href}`).toBe(true);
    }
    for (const href of PINNED_HREFS) {
      expect(hrefs).toContain(href);
    }
  });

  it("shows the gate pipeline with result and detail for every gate", () => {
    render(<AgreementReferenceReceipt />);
    const gates = screen.getByTestId("agreement-gates");
    expect(gates.children).toHaveLength(AGREEMENT_REFERENCE.gates.length);
    expect(gates).toHaveTextContent("Terms fixed first");
    expect(gates).toHaveTextContent("Human reviewer");
    expect(gates).toHaveTextContent("Deadline");
  });

  it("marks the completed safety record with real links", () => {
    render(<AgreementReferenceReceipt />);
    const records = screen.getAllByTestId("agreement-safety-record");
    expect(records).toHaveLength(3);
    const completed = records.find((r) => r.dataset.status === "completed");
    expect(completed).toBeDefined();
    expect(completed!).toHaveTextContent("Completed");
    expect(completed!).toHaveTextContent("Released 1 USDC to Ana");
    expect(completed!.querySelectorAll("a[href]").length).toBeGreaterThanOrEqual(2);
  });

  it("labels blocked examples as rule previews that were never submitted, with no links", () => {
    render(<AgreementReferenceReceipt />);
    const records = screen.getAllByTestId("agreement-safety-record");
    const previews = records.filter((r) => r.dataset.status === "rule-preview");
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview).toHaveTextContent(/Rule preview/i);
      const notes = preview.querySelectorAll('[data-testid="agreement-safety-note"]');
      expect(notes.length).toBe(1);
      expect(notes[0]!.textContent).toMatch(/Not submitted/i);
      expect(notes[0]!.textContent).toMatch(/no gas was spent/i);
      expect(preview.querySelector("a[href]")).toBeNull();
    }
    expect(previews[0]).toHaveTextContent(/different address/i);
    expect(previews[1]).toHaveTextContent(/amount above the agreement/i);
  });

  it("separates contract enforcement from product checks in the summary", () => {
    render(<AgreementReferenceReceipt />);
    const summary = screen.getByTestId("agreement-safety-summary");
    expect(summary.textContent).toMatch(/contract's rules, not transactions on Sui/);
    expect(summary.textContent).toMatch(/product checks/);
  });

  it("keeps private evidence and independent verification behind disclosures", () => {
    render(<AgreementReferenceReceipt />);
    // Collapsed by default: no Walrus URL visible before expanding.
    expect(
      screen.queryByTestId("agreement-privacy-lead"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("agreement-privacy-trigger"));
    expect(screen.getByTestId("agreement-privacy-lead")).toBeInTheDocument();
    expect(screen.getByText("View ciphertext")).toHaveAttribute(
      "href",
      "https://aggregator.walrus-testnet.walrus.space/v1/blobs/jIrFIrjYiVZ7yrt9Gv6U5x3XawzycyykQ7NprAwapuk",
    );
    fireEvent.click(screen.getByTestId("agreement-verify-trigger"));
    expect(screen.getByTestId("agreement-verify-lead")).toBeInTheDocument();
  });

  it("never invents model identities, request ids, or em-dash copy", () => {
    render(<AgreementReferenceReceipt />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/deepseek|kimi|req-\d{6,}/i);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/refused on-chain|aborted on Sui/i);
  });
});
