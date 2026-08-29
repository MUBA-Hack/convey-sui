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

describe("ProofVerifier", () => {
  it("loads an honest DEMO sample for a zero-setup verification", () => {
    render(<ProofVerifier />);
    fireEvent.click(screen.getByRole("button", { name: /load sample receipt/i }));
    expect((screen.getByLabelText(/receipt json/i) as HTMLTextAreaElement).value).toContain('"mode": "demo"');
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/demo structure verified/i);
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/no chain query/i);
  });

  it("verifies pasted demo JSON and states the evidence boundary", () => {
    render(<ProofVerifier />);
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/demo structure verified/i);
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/no chain query/i);
    expect(screen.getByTestId("proof-result")).toHaveTextContent(/2\.5\s*SUI/i);
  });

  it("surfaces strict validation failures", () => {
    render(<ProofVerifier />);
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
    expect(screen.getByText(/encoded in this url/i)).toBeInTheDocument();
  });

  it("creates a share URL only after validation", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<ProofVerifier />);
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
    const url = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    expect(url).toContain("/proof?p=");
  });

  it("imports a JSON file", async () => {
    render(<ProofVerifier />);
    const file = new File([demoJson], "proof.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/import json/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/receipt json/i)).toHaveValue(demoJson));
  });
});

// ---------------------------------------------------------------------------
// ProofVerifier — responsive layout: evidence is the mobile protagonist
// ---------------------------------------------------------------------------

describe("ProofVerifier — responsive evidence priority", () => {
  it("places the verified evidence above the editor in DOM order after URL hydration", async () => {
    const { encodeReceiptProofPayload } = await import("@/lib/commerce/receipt-proof");
    const payload = encodeReceiptProofPayload(JSON.parse(demoJson));
    window.history.replaceState({}, "", `/proof?p=${payload}`);
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("proof-result")).toBeInTheDocument());

    const editor = screen.getByLabelText(/receipt json/i);
    const aside = screen.getByLabelText("Proof evidence");
    // The evidence aside must precede the editor in DOM order so that on a
    // 390x844 mobile viewport the verified outcome stacks above the JSON
    // editor without relying on a dynamically swapped CSS `order` class.
    expect(
      editor.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("places the verified evidence above the editor after a manual verify, not only URL hydration", () => {
    render(<ProofVerifier />);
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));

    const editor = screen.getByLabelText(/receipt json/i);
    const aside = screen.getByLabelText("Proof evidence");
    expect(
      editor.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("keeps the editor above the empty evidence panel when nothing is verified yet", () => {
    render(<ProofVerifier />);
    const editor = screen.getByLabelText(/receipt json/i);
    const aside = screen.getByLabelText("Proof evidence");
    // With no result, the editor is the protagonist and precedes the empty
    // evidence panel in DOM order on mobile.
    expect(
      editor.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses static desktop order classes so desktop keeps editor-left/evidence-right without a dynamic swap", () => {
    render(<ProofVerifier />);
    const inputPanel = screen.getByLabelText(/receipt json/i).closest(
      "[data-proof-panel='input']",
    );
    const aside = screen.getByLabelText("Proof evidence");
    expect(inputPanel).not.toBeNull();
    // Static (always-present) desktop order classes — not a class that is
    // toggled on only after hydration — keep the layout deterministic.
    expect(inputPanel!.className).toContain("lg:order-first");
    expect(aside.className).toContain("lg:order-last");
    // The unreliable dynamically-toggled order pair must not be used.
    expect(aside.className).not.toContain("order-first");
    expect(aside.className).not.toContain("lg:order-none");
  });
});

// ---------------------------------------------------------------------------
// ProofVerifier — black verification stage leads the mobile first viewport
// ---------------------------------------------------------------------------

describe("ProofVerifier — black verification stage leads on mobile", () => {
  it("leads the verified DEMO result with a black stage containing amount, digest mark, and LOCAL/DEMO", () => {
    render(<ProofVerifier />);
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
    // The single mode mark labels LOCAL/DEMO honestly.
    expect(stage).toHaveTextContent(/LOCAL\/DEMO/i);
  });

  it("labels a verified real receipt stage as LOCAL/TESTNET", async () => {
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
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: realJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    const stage = screen.getByTestId("proof-stage");
    expect(stage).toHaveTextContent(/LOCAL\/TESTNET/i);
  });

  it("places the long explainer below the black stage in DOM order", () => {
    render(<ProofVerifier />);
    fireEvent.change(screen.getByLabelText(/receipt json/i), { target: { value: demoJson } });
    fireEvent.click(screen.getByRole("button", { name: /verify structure/i }));
    const stage = screen.getByTestId("proof-stage");
    const result = screen.getByTestId("proof-result");
    // The long claim/explainer text follows the stage inside the result.
    const claim = Array.from(result.querySelectorAll("p")).find((p) =>
      /no chain query/i.test(p.textContent ?? ""),
    );
    expect(claim).toBeDefined();
    expect(
      claim!.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });
});
