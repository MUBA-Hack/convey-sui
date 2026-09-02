// @vitest-environment jsdom
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// next/image is no longer used by the header (the brand mark is an inline
// SVG), so no next/image mock is needed here.

/**
 * DOM tests pinning the commerce site header navigation.
 *
 * The header is the commerce shell's primary nav: the Convey brand mark,
 * Home, Pay, Continue elsewhere, Activity, Treasury, and the wallet control. These tests pin
 * that the commerce routes render and are marked active for the current
 * path, that the brand mark is present, that the wallet control renders,
 * and that no dead legacy hrefs (/app, /fact-check, /claims, /agents,
 * /verify, /status, /build-progress) survive in the DOM.
 *
 * Next routing (`usePathname`) and `next/link` are mocked so the test stays
 * a fast, isolated DOM test. The wallet button is mocked so it does not
 * boot the full dapp-kit/enoki wallet network.
 */

// Hoisted mutable holder so the mocked usePathname can be reconfigured per
// test without re-evaluating the vi.mock factory.
const { pathname } = vi.hoisted(() => ({ pathname: { current: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  // Render Link as a plain anchor so hrefs are observable in jsdom without a
  // Next router. Pass-through of className/aria/onClick keeps behavior intact.
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

vi.mock("@/components/wallet/connect-button", () => ({
  // Stand-in for the wallet control: deterministic, no wallet network.
  WalletConnectButton: () => (
    <button type="button" data-testid="wallet-connect">
      Sign in
    </button>
  ),
}));

import { SiteHeader } from "@/components/site-header";

const DEAD_HREFS = ["/app", "/fact-check", "/claims", "/agents", "/verify", "/status", "/build-progress"];

beforeEach(() => {
  pathname.current = "/";
});

afterEach(() => {
  cleanup();
});

describe("SiteHeader — commerce navigation", () => {
  it("keeps every secondary journey in one compact menu on every route", () => {
    pathname.current = "/qr-ferry";
    render(<SiteHeader />);

    expect(screen.queryByRole("link", { name: /Continue elsewhere/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /toggle navigation menu/i }));

    const home = screen.getByRole("link", { name: "Home" });
    const pay = screen.getByRole("link", { name: "Pay" });
    const relay = screen.getByRole("link", { name: /Continue elsewhere/ });
    const activity = screen.getByRole("link", { name: /Activity/ });
    const treasury = screen.getByRole("link", { name: /Treasury/ });

    expect(home).toHaveAttribute("href", "/");
    expect(pay).toHaveAttribute("href", "/pay");
    expect(relay).toHaveAttribute("href", "/qr-ferry");
    expect(activity).toHaveAttribute("href", "/proof");
    expect(treasury).toHaveAttribute("href", "/strategy");
  });

  it("keeps the companion homepage focused while the menu exposes payment journeys", () => {
    pathname.current = "/";
    render(<SiteHeader />);

    expect(screen.queryByRole("link", { name: /Continue elsewhere/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Treasury/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /toggle navigation menu/i }));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Pay" })).toHaveAttribute("href", "/pay");
    expect(screen.getByRole("link", { name: /Continue elsewhere/ })).toHaveAttribute("href", "/qr-ferry");
    expect(screen.getByRole("link", { name: /Activity/ })).toHaveAttribute("href", "/proof");
    expect(screen.getByRole("link", { name: /Treasury/ })).toHaveAttribute("href", "/strategy");
  });

  it("marks the active commerce route with aria-current=page", () => {
    pathname.current = "/qr-ferry";
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: /toggle navigation menu/i }));
    const relay = screen.getByRole("link", { name: /Continue elsewhere/ });
    expect(relay).toHaveAttribute("aria-current", "page");
    expect(relay).toHaveAttribute("data-active", "true");

    // Non-active commerce links are not marked current.
    expect(screen.getByRole("link", { name: "Pay" })).not.toHaveAttribute("aria-current");
  });
});

describe("SiteHeader — brand mark", () => {
  it("renders the Convey brand link and the vector mark lockup", () => {
    render(<SiteHeader />);

    const brand = screen.getByRole("link", { name: "Convey home" });
    expect(brand).toHaveAttribute("href", "/");

    // The mark is a deterministic inline SVG (currentColor vector), not a
    // raster — it inherits the wordmark's black and stays crisp at any size.
    const mark = brand.querySelector("[data-testid='convey-mark']");
    expect(mark).not.toBeNull();
    expect(mark?.tagName.toLowerCase()).toBe("svg");
    // The wordmark is a deliberate finance-house weight, not a thin generic
    // SaaS wordmark.
    const wordmark = brand.querySelector(".text-\\[23px\\]");
    expect(wordmark).not.toBeNull();
    expect(wordmark?.textContent).toBe("Convey");
    expect(wordmark?.className).toMatch(/font-semibold/);
  });
});

describe("SiteHeader — consistent sticky light header on every route", () => {
  it("renders a sticky header (not fixed) so it is consistent on all routes", () => {
    for (const path of ["/", "/qr-ferry", "/strategy", "/proof"]) {
      pathname.current = path;
      cleanup();
      const { container } = render(<SiteHeader />);
      const header = container.querySelector("header");
      expect(header).not.toBeNull();
      expect(header?.className).toMatch(/\bsticky\b/);
      expect(header?.className).not.toMatch(/\bfixed\b/);
    }
    cleanup();
  });

  it("does not render the landing top-blur chrome on any route", () => {
    for (const path of ["/", "/qr-ferry", "/proof"]) {
      pathname.current = path;
      cleanup();
      const { container } = render(<SiteHeader />);
      expect(container.querySelector(".cv-top-blur")).toBeNull();
    }
    cleanup();
  });

  it("paints the brand wordmark black so the black raster mark is visible", () => {
    pathname.current = "/";
    render(<SiteHeader />);
    const brand = screen.getByRole("link", { name: "Convey home" });
    expect(brand.className).toMatch(/text-black\b/);
    expect(brand.className).not.toMatch(/text-\[#F3F3F3\]/);
  });
});

describe("SiteHeader — wallet control", () => {
  it("renders the wallet connect control", () => {
    render(<SiteHeader />);
    const walletControls = screen.getAllByTestId("wallet-connect");
    expect(walletControls.length).toBeGreaterThanOrEqual(1);
    expect(walletControls[0]).toHaveTextContent("Sign in");
  });
});

describe("SiteHeader — no dead legacy hrefs", () => {
  it("renders no links to deleted legacy console or /app routes", () => {
    const { container } = render(<SiteHeader />);

    const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    for (const dead of DEAD_HREFS) {
      expect(hrefs).not.toContain(dead);
    }
  });

  it("renders no Legacy console label or Open-the-app control", () => {
    render(<SiteHeader />);

    expect(screen.queryByText("Legacy console")).toBeNull();
    expect(screen.queryByLabelText("Legacy console navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open the app" })).toBeNull();
    expect(screen.queryByLabelText("Open the Convey app")).toBeNull();
  });
});

describe("SiteHeader — strict monochrome", () => {
  // Blue/hue classes that must never appear in the header chrome.
  const BLUE_CLASS_FRAGMENTS = [
    "cv-glow",
    "cv-slab",
    "cv-footer-ground",
    "cv-navy-ground",
    "cv-light-wash",
  ];

  it("renders no blue/hue ground or glow classes in the header", () => {
    const { container } = render(<SiteHeader />);
    for (const frag of BLUE_CLASS_FRAGMENTS) {
      expect(container.querySelector(`.${frag}`)).toBeNull();
    }
  });

  it("the active nav chip uses the monochrome chip, not the blue accent variant", () => {
    pathname.current = "/qr-ferry";
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: /toggle navigation menu/i }));
    const active = screen.getByRole("link", { name: /Continue elsewhere/ });
    expect(active.getAttribute("data-active")).toBe("true");
    const cls = active.getAttribute("class") ?? "";
    expect(cls).toContain("cv-nav-chip");
    // The blue accent chip variant is never applied to a nav link.
    expect(cls).not.toContain("cv-nav-chip--accent");
  });
});
