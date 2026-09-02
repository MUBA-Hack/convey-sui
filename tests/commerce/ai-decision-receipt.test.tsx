import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AiDecisionReceiptRow } from "@/components/commerce/ai-decision-receipt";
import { ActivityPanel } from "@/components/commerce/activity-panel";
import {
  AI_DECISION_RECEIPT_STORE_KEY,
  AI_DECISION_RECEIPT_STORE_VERSION,
  type AiDecisionReceiptRecord,
} from "@/lib/activity/ai-decision-receipt";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string },
  ) => { window: Window & typeof globalThis };
};
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
vi.stubGlobal("window", dom.window);
vi.stubGlobal("self", dom.window);
vi.stubGlobal("document", dom.window.document);
vi.stubGlobal("navigator", dom.window.navigator);
vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
vi.stubGlobal("SVGElement", dom.window.SVGElement);
vi.stubGlobal("Element", dom.window.Element);
vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const originalFetch = globalThis.fetch;

const record: AiDecisionReceiptRecord = {
  requestId: "req-1788163015848361746-40652",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731",
  timestamp: "2026-08-31T07:57:46Z",
  status: "unverified",
};

const verified = {
  kind: "verified",
  receipt: {
    requestId: record.requestId,
    model: record.model,
    nodeId: "67670",
    timestamp: record.timestamp,
    outcome: "success",
    statusCode: 200,
    stream: true,
    totalTokens: 34064,
    ttftMs: 15650,
    durationMs: 50920,
  },
};

function fetchResponse(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.stubGlobal("fetch", originalFetch);
});

describe("AiDecisionReceiptRow", () => {
  it("shows verified result first, then accessible expandable public details", async () => {
    const fetchImpl = fetchResponse(verified);
    vi.stubGlobal("fetch", fetchImpl);
    const view = render(<AiDecisionReceiptRow record={record} />);

    await waitFor(() => expect(view.getByText("AI route verified")).toBeInTheDocument());
    const trigger = view.getByRole("button", { name: /AI route verified/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).toMatch(/min-h-11/);
    expect(view.queryByText("67670")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const details = view.getByTestId("ai-decision-receipt-details");
    expect(details).toHaveTextContent("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(details).toHaveTextContent("67670");
    expect(details).toHaveTextContent("success");
    expect(details).toHaveTextContent("200");
    expect(details).toHaveTextContent("34,064");
    expect(details).toHaveTextContent("15.65 s");
    expect(details).toHaveTextContent("50.92 s");
    expect(details.textContent ?? "").not.toMatch(/prompt|response content|SDK|demo/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/companion/receipt/verify",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ requestId: record.requestId, expectedModel: record.model }),
      }),
    );
  });

  it.each([
    [{ kind: "mismatch", fields: ["model"] }, "Needs another check", "mismatch"],
    [{ kind: "not_found" }, "Needs another check", "not_found"],
    [{ kind: "unavailable" }, "Verification unavailable", "unavailable"],
  ] as const)("renders %s as a distinct honest monochrome state", async (body, label, state) => {
    vi.stubGlobal("fetch", fetchResponse(body));
    const view = render(<AiDecisionReceiptRow record={record} />);

    await waitFor(() => expect(view.getByText(label)).toBeInTheDocument());
    expect(view.getByTestId("ai-decision-receipt")).toHaveAttribute("data-state", state);
    expect(view.queryByText("AI route verified")).not.toBeInTheDocument();
  });

  it("maps malformed API data and request failures to unavailable", async () => {
    vi.stubGlobal("fetch", fetchResponse({ kind: "verified", prompt: "secret" }));
    const view = render(<AiDecisionReceiptRow record={record} />);
    await waitFor(() => expect(view.getByText("Verification unavailable")).toBeInTheDocument());

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network details")));
    view.rerender(<AiDecisionReceiptRow key="retry" record={{ ...record, requestId: "req-00000000" }} />);
    await waitFor(() => expect(view.getByText("Verification unavailable")).toBeInTheDocument());
    expect(document.body.textContent ?? "").not.toMatch(/network details|secret/i);
  });

  it("uses fluid mobile-safe layout without a desktop minimum width", () => {
    vi.stubGlobal("fetch", fetchResponse({ kind: "unavailable" }));
    const view = render(<AiDecisionReceiptRow record={record} />);
    const row = view.getByTestId("ai-decision-receipt");
    expect(row.className).toMatch(/w-full|min-w-0/);
    expect(row.className).not.toMatch(/min-w-\[/);
  });

  it("surfaces a saved AI routing receipt in Activity without transfer history", async () => {
    window.localStorage.setItem(
      AI_DECISION_RECEIPT_STORE_KEY,
      JSON.stringify({ version: AI_DECISION_RECEIPT_STORE_VERSION, items: [record] }),
    );
    vi.stubGlobal("fetch", fetchResponse({ kind: "unavailable" }));
    const view = render(<ActivityPanel />);

    expect(view.getByRole("heading", { name: "AI checks" })).toBeInTheDocument();
    expect(view.getByTestId("ai-decision-receipt")).toBeInTheDocument();
    await waitFor(() =>
      expect(view.getByText("Verification unavailable")).toBeInTheDocument(),
    );
  });
});
