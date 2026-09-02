import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

const testDom = typeof document === "undefined"
  ? new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
  : null;

if (testDom) {
  const browserGlobals = {
    window: testDom.window,
    document: testDom.window.document,
    navigator: testDom.window.navigator,
    HTMLElement: testDom.window.HTMLElement,
    SVGElement: testDom.window.SVGElement,
    Element: testDom.window.Element,
    Node: testDom.window.Node,
    Event: testDom.window.Event,
    File: testDom.window.File,
    Storage: testDom.window.Storage,
    localStorage: testDom.window.localStorage,
    MutationObserver: testDom.window.MutationObserver,
    getComputedStyle: testDom.window.getComputedStyle.bind(testDom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  };
  for (const [key, value] of Object.entries(browserGlobals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
}

const { cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
await import("@testing-library/jest-dom/vitest");
const { ReceiptSplitFlow } = await import("@/components/companion/receipt-split-flow");

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:receipt-preview"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

afterAll(() => testDom?.window.close());

function loadSample(): void {
  fireEvent.click(screen.getByRole("button", { name: /use sample receipt/i }));
}

function confirmReceipt(): void {
  fireEvent.click(screen.getByRole("checkbox", { name: /i checked these details/i }));
  fireEvent.click(screen.getByRole("button", { name: /build split/i }));
}

describe("ReceiptSplitFlow", () => {
  it("keeps allocation behind explicit receipt confirmation", () => {
    render(<ReceiptSplitFlow />);
    loadSample();
    expect(screen.queryByTestId("receipt-obligation-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build split/i })).toBeDisabled();
    confirmReceipt();
    expect(screen.getByTestId("receipt-obligation-summary")).toBeInTheDocument();
  });

  it("renders exact balanced obligations from the authoritative domain", () => {
    render(<ReceiptSplitFlow />);
    loadSample();
    confirmReceipt();
    const summary = screen.getByTestId("receipt-obligation-summary");
    expect(within(summary).getByText("10.35 USDC")).toBeInTheDocument();
    expect(within(summary).getAllByText("3.45 USDC")).toHaveLength(3);
    expect(within(summary).getByText(/balanced to receipt/i)).toBeInTheDocument();
  });

  it("surfaces duplicate names and requires item-level person selection", () => {
    render(<ReceiptSplitFlow />);
    loadSample();
    expect(screen.getByText(/2 people named dave/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /coffee.*dave · home/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /cake.*dave · work/i })).toBeChecked();
  });

  it("keeps the raw photo in a revocable browser preview and never persists it", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    render(<ReceiptSplitFlow />);
    const photo = new File(["private-image-bytes"], "receipt.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/choose receipt photo/i), { target: { files: [photo] } });
    expect(screen.getByRole("img", { name: /receipt preview/i })).toHaveStyle({
      backgroundImage: 'url("blob:receipt-preview")',
    });
    expect(screen.getByText(/enter the receipt details below/i)).toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receipt-preview");
    await waitFor(() => expect(screen.queryByRole("img", { name: /receipt preview/i })).not.toBeInTheDocument());
  });

  it("keeps a chat acknowledgement in requested state rather than settled", () => {
    render(<ReceiptSplitFlow />);
    loadSample();
    confirmReceipt();
    fireEvent.click(screen.getByRole("button", { name: /prepare requests/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark reply seen/i }));
    expect(screen.getAllByTestId("obligation-state").map((node) => node.textContent)).toEqual([
      "Requested",
      "Requested",
      "Requested",
    ]);
    expect(screen.queryByTestId("settled-obligation")).not.toBeInTheDocument();
  });
});
