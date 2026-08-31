// @vitest-environment jsdom
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ACTIVITY_STORE_KEY, ACTIVITY_STORE_VERSION } from "@/lib/activity/types";
import type { ActivityItem } from "@/lib/activity/types";
import { ProofVerifier } from "@/components/commerce/proof-verifier";
import { ActivityPanel } from "@/components/commerce/activity-panel";
import { ActivityItemCard } from "@/components/commerce/activity-item";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const item: ActivityItem = {
  id: "ana-1",
  href: "/proof?r=AA",
  title: "Send to Ana",
  amountLabel: "100 USDC",
  detailLabel: "Manila, Philippines",
  nextOwner: "Ana",
  updatedAt: "2026-08-31T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("ActivityPanel — no-query /proof", () => {
  it("renders the empty Activity journey with Send money as the primary action", async () => {
    render(<ProofVerifier />);
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeInTheDocument());
    expect(screen.getByTestId("activity-page-title")).toHaveTextContent("Recent transfers.");
    expect(screen.getByTestId("activity-empty-slab").className).toContain("bg-black");
    const send = screen.getByTestId("activity-send-money");
    expect(send).toHaveAttribute("href", "/");
    expect(send).toHaveTextContent(/send money/i);
    expect(screen.queryByLabelText(/receipt json/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /advanced details/i })).toBeInTheDocument();
  });

  it("lists a local item with one CTA that opens the portable receipt href", async () => {
    window.localStorage.setItem(
      ACTIVITY_STORE_KEY,
      JSON.stringify({ version: ACTIVITY_STORE_VERSION, items: [item] }),
    );
    render(<ActivityPanel />);
    expect(screen.getByTestId("activity-list")).toBeInTheDocument();
    expect(screen.getByTestId("activity-page-title").className).toMatch(/text-3xl/);
    expect(screen.getByTestId("activity-page-title").className).toMatch(/sm:text-4xl/);
    expect(screen.getByTestId("activity-page-title").className).not.toMatch(/text-5xl/);
    expect(screen.getByTestId("activity-page-intro")).toHaveTextContent(
      "Saved on this device. Open to check current status.",
    );
    expect(screen.getByTestId("activity-list").querySelector("ul")?.className).toMatch(/border-t/);
    expect(screen.getByTestId("activity-item")).toHaveTextContent("Send to Ana");
    expect(screen.getByTestId("activity-item-amount")).toHaveTextContent("100 USDC");
    expect(screen.getByTestId("activity-item-amount").className).toMatch(/tabular-nums/);
    expect(screen.getByTestId("activity-item-nav")).toHaveTextContent(
      "Manila, Philippines · Saved plan: Ana",
    );
    expect(screen.getByTestId("activity-item-nav")).not.toHaveTextContent("Send to Ana");
    expect(screen.getByTestId("activity-item").textContent ?? "").not.toMatch(
      /Confirmed on Sui|Released|Refunded|funds protected/i,
    );
    const ctas = screen.getAllByTestId("activity-item-cta");
    expect(ctas).toHaveLength(1);
    const cta = ctas[0]!;
    expect(cta).toHaveAttribute("href", "/proof?r=AA");
    expect(cta).toHaveAttribute("aria-label", "Open receipt: Send to Ana, 100 USDC");
    expect(cta.className).toMatch(/\bgroup\b/);
    expect(cta.className).not.toMatch(/hover:opacity/);
    expect(cta.className).not.toMatch(/bg-black|rounded-2xl|rounded-xl/);
    expect(screen.getByTestId("activity-item").className).not.toMatch(/rounded-2xl|bg-white/);
  });

  it("gives multiple receipt links distinct accessible names", () => {
    const second = {
      ...item,
      id: "javier-1",
      href: "/proof?r=BB",
      title: "Send to Javier",
      amountLabel: "600 MYR",
    };
    render(
      <>
        <ActivityItemCard item={item} />
        <ActivityItemCard item={second} />
      </>,
    );
    expect(screen.getByRole("link", { name: /Send to Ana, 100 USDC/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Send to Javier, 600 MYR/ })).toBeInTheDocument();
  });

  it("fails safely when the browser blocks localStorage access", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    try {
      render(<ActivityPanel />);
      await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeInTheDocument());
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });

  it("treats malformed local storage as empty, never as proof", async () => {
    window.localStorage.setItem(ACTIVITY_STORE_KEY, "{not-json");
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("activity-list")).not.toBeInTheDocument();
  });

  it("ignores tampered storage that injects an external href", async () => {
    window.localStorage.setItem(
      ACTIVITY_STORE_KEY,
      JSON.stringify({
        version: ACTIVITY_STORE_VERSION,
        items: [{ ...item, href: "https://evil.example/proof?r=AA" }],
      }),
    );
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("activity-item-cta")).not.toBeInTheDocument();
  });

  it("never paints chain-final labels from local navigation data", () => {
    render(<ActivityItemCard item={item} />);
    const row = screen.getByTestId("activity-item");
    expect(row).toHaveTextContent("Saved plan: Ana");
    expect(row.textContent ?? "").not.toMatch(
      /Confirmed on Sui|Released|Refunded|funds protected|Held for review/i,
    );
  });

  it("does not render an injected external href from a local card", () => {
    render(
      <ActivityItemCard
        item={{
          ...item,
          href: "/proof?r=AA",
        }}
      />,
    );
    const cta = screen.getByTestId("activity-item-cta");
    expect(cta.getAttribute("href")).toBe("/proof?r=AA");
    expect(cta.getAttribute("href")).not.toMatch(/^https?:/i);
  });

  it("keeps a shared receipt query on /proof as the receipt verifier, not Activity", async () => {
    const { encodeReceiptProofPayload } = await import("@/lib/commerce/receipt-proof");
    const payload = encodeReceiptProofPayload({
      mode: "demo",
      demo: true,
      digest: "DEMO-abcdef0123456789",
      amountMist: "2500000000",
      merchantAddress: `0x${"11".repeat(32)}`,
      explorerUrl: null,
      label: "DEMO simulation — no on-chain settlement",
      exportedAt: "2026-08-30T00:00:00.000Z",
    });
    window.history.replaceState({}, "", `/proof?p=${payload}`);
    render(<ProofVerifier />);
    expect(screen.queryByTestId("activity-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("activity-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("proof-route-pending")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("proof-result")).toBeInTheDocument());
    expect(screen.queryByTestId("activity-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("activity-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proof-route-pending")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Receipt")).toBeInTheDocument();
  });

  it("treats an empty receipt query as invalid receipt input, not Activity", async () => {
    window.history.replaceState({}, "", "/proof?r=");
    render(<ProofVerifier />);
    expect(screen.queryByTestId("activity-empty")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Receipt")).toBeInTheDocument());
    expect(screen.queryByTestId("activity-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("activity-list")).not.toBeInTheDocument();
    expect(screen.getByText(/invalid|malformed|could not/i)).toBeInTheDocument();
  });
});
