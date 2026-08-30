// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProofVerifier } from "@/components/commerce/proof-verifier";

const merchant = `0x${"11".repeat(32)}`;
const demoJson = JSON.stringify({
  mode: "demo",
  demo: true,
  digest: "DEMO-abcdef0123456789",
  amountMist: "2500000000",
  merchantAddress: merchant,
  explorerUrl: null,
  label: "DEMO simulation — no on-chain settlement",
  exportedAt: "2026-08-30T00:00:00.000Z",
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

// The JSON editor, sample loader, and verify action live under the Advanced
// details disclosure. Open it before interacting with those controls.
function openAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: /advanced details/i }));
}

describe("ProofVerifier", () => {
  it("loads an honest DEMO sample for a zero-setup verification", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /load sample receipt/i }));
    expect((screen.getByLabelText(/receipt json/i) as HTMLTextAreaElement).value).toContain('"mode": "demo"');
    // Primary result leads with customer language, not engineering labels.
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/sample receipt/i);
    // The technical "no chain query" claim is honestly present under Advanced.
    expect(screen.getByTestId("proof-technical")).toHaveTextContent(/no chain query/i);
  });

  it("verifies pasted demo JSON and states the evidence boundary", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/sample receipt/i);
    expect(screen.getByTestId("proof-technical")).toHaveTextContent(/no chain query/i);
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/2\.5\s*SUI/i);
  });

  it("surfaces strict validation failures as the primary result", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), {
      target: { value: JSON.stringify({ ...JSON.parse(demoJson), demo: false }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/mode/i);
  });

  it("loads a shareable URL payload and does not imply server storage", async () => {
    const { encodeReceiptProofPayload } = await import("@/lib/commerce/receipt-proof");
    const payload = encodeReceiptProofPayload(JSON.parse(demoJson));
    window.history.replaceState({}, "", `/proof?p=${payload}`);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("proof-result")).toBeInTheDocument());
    expect(screen.getByText(/encoded in this link/i)).toBeInTheDocument();
  });

  it("creates a share URL only after validation", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    const url = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    expect(url).toContain("/proof?p=");
  });

  it("imports a JSON file", async () => {
    render(<ProofVerifier />);
    openAdvanced();
    const file = new File([demoJson], "proof.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/import json/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/receipt json/i)).toHaveValue(demoJson));
  });
});

// ---------------------------------------------------------------------------
// ProofVerifier — result-first layout: the receipt leads, Advanced follows
// ---------------------------------------------------------------------------

describe("ProofVerifier — result-first layout", () => {
  it("places the verified receipt above the Advanced details disclosure after URL hydration", async () => {
    const { encodeReceiptProofPayload } = await import("@/lib/commerce/receipt-proof");
    const payload = encodeReceiptProofPayload(JSON.parse(demoJson));
    window.history.replaceState({}, "", `/proof?p=${payload}`);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("proof-result")).toBeInTheDocument());

    const resultPanel = screen.getByLabelText("Receipt");
    const advanced = screen.getByTestId("proof-advanced-trigger");
    // The receipt panel precedes the Advanced details disclosure in DOM order
    // so a customer opening a share link sees the receipt first.
    expect(
      advanced.compareDocumentPosition(resultPanel) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("places the verified receipt above Advanced after a manual verify", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const resultPanel = screen.getByLabelText("Receipt");
    const advanced = screen.getByTestId("proof-advanced-trigger");
    expect(
      advanced.compareDocumentPosition(resultPanel) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("shows a customer empty state and keeps Advanced collapsed when nothing is verified yet", () => {
    render(<ProofVerifier />);
    expect(screen.getByText(/no receipt open yet/i)).toBeInTheDocument();
    // The Advanced disclosure trigger is present but its body (editor) is not
    // rendered until opened.
    expect(screen.queryByLabelText(/receipt json/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProofVerifier — black verification stage leads the mobile first viewport
// ---------------------------------------------------------------------------

describe("ProofVerifier — black verification stage leads on mobile", () => {
  it("leads the verified DEMO result with a black stage containing amount, digest mark, and demo mode", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const stage = screen.getByTestId("proof-stage");
    // The stage is a black object that leads the verified result.
    expect(stage.className).toContain("bg-black");
    expect(stage.className).toContain("text-white");
    // Amount is the protagonist inside the stage.
    expect(stage).toHaveTextContent(/2\.5\s*SUI/i);
    // The digest mark is rendered inside the stage with the full value
    // accessible via title/data-full and a truncated visible stripe.
    const digestEl = stage.querySelector("[data-proof-digest]");
    expect(digestEl).not.toBeNull();
    expect(digestEl?.getAttribute("title")).toMatch(/DEMO-abcdef0123456789/);
    expect(digestEl?.getAttribute("data-full")).toMatch(/DEMO-abcdef0123456789/);
    expect(digestEl?.textContent).not.toContain("DEMO-abcdef0123456789");
    // The mode is carried on the stage as a data attribute (not a visible
    // engineering badge in the primary view).
    expect(stage.getAttribute("data-proof-mode")).toBe("demo");
    // No LOCAL/DEMO engineering badge leaks into the primary stage.
    expect(stage.textContent ?? "").not.toMatch(/LOCAL\/DEMO/i);
  });

  it("labels a verified real receipt stage with the real mode attribute", async () => {
    const realJson = JSON.stringify({
      mode: "real",
      demo: false,
      digest: "4vQpX9GmY8KcT2dW7rHsN3aZ6jLfP5uE1bCxRkAq",
      amountMist: "2500000000",
      merchantAddress: merchant,
      explorerUrl: "https://suiscan.testnet.sui.io/tx/4vQpX9GmY8KcT2dW7rHsN3aZ6jLfP5uE1bCxRkAq",
      label: "Real testnet transfer",
      exportedAt: "2026-08-30T00:00:00.000Z",
    });
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: realJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    const stage = screen.getByTestId("proof-stage");
    expect(stage.getAttribute("data-proof-mode")).toBe("real");
    // No LOCAL/TESTNET engineering badge in the primary stage.
    expect(stage.textContent ?? "").not.toMatch(/LOCAL\/TESTNET/i);
  });

  it("places the long explainer below the black stage in DOM order", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    const stage = screen.getByTestId("proof-stage");
    const result = screen.getByTestId("proof-result");
    // The long boundary explainer follows the stage inside the result.
    const claim = Array.from(result.querySelectorAll("p")).find((p) =>
      /no payment was sent/i.test(p.textContent ?? ""),
    );
    expect(claim).toBeDefined();
    expect(
      claim!.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("keeps canonical fields and structural checks under Advanced details, not in the primary result", () => {
    render(<ProofVerifier />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    // Primary result holds the customer summary, not the structural checks.
    const result = screen.getByTestId("proof-result");
    expect(result.textContent ?? "").not.toMatch(/structural checks/i);
    // Structural checks and canonical fields live under Advanced.
    expect(screen.getByTestId("proof-structural-checks")).toBeInTheDocument();
    expect(screen.getByTestId("proof-technical")).toHaveTextContent(/canonical fields/i);
  });
});
