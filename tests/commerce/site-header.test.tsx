// @vitest-environment jsdom
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * DOM tests pinning the commerce site header navigation.
 *
 * The header is the commerce shell's primary nav: the Convey brand mark,
 * Shop, QR Ferry, Build progress, and the wallet control. These tests pin
 * that the commerce routes render and are marked active for the current
 * path, that the brand mark is present, that the wallet control renders,
 * and that no dead legacy hrefs (/app, /fact-check, /claims, /agents,
 * /verify, /status) survive in the DOM.
 *
 * Next routing (`usePathname`) and `next/link` are mocked so the test stays
 * a fast, isolated DOM test. The wallet button is mocked so it does not
 * boot the full dapp-kit/enoki wallet network.
 */

// Hoisted mutable holder so the mocked usePathname can be reconfigured per
// test without re-evaluating the vi.mock factory.
const { pathname } = vi.hoisted(() => ({ pathname: { current: "/build-progress" } }));

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

vi.mock("next/image", () => ({
  // Pass-through so the original src is observable in jsdom (next/image
  // otherwise rewrites src to a /_next/image optimizer URL).
  default: (props: ComponentPropsWithoutRef<"img">) => <img {...props} />,
}));

import { SiteHeader } from "@/components/site-header";

const DEAD_HREFS = ["/app", "/fact-check", "/claims", "/agents", "/verify", "/status"];

beforeEach(() => {
  pathname.current = "/build-progress";
});

afterEach(() => {
  cleanup();
});

describe("SiteHeader — commerce navigation", () => {
  it("renders the Shop, QR Ferry, and Build progress commerce links", () => {
    render(<SiteHeader />);

    const shop = screen.getByRole("link", { name: "Shop" });
    const qrFerry = screen.getByRole("link", { name: "QR Ferry" });
    const buildProgress = screen.getByRole("link", { name: "Build progress" });

    expect(shop).toHaveAttribute("href", "/");
    expect(qrFerry).toHaveAttribute("href", "/qr-ferry");
    expect(buildProgress).toHaveAttribute("href", "/build-progress");
  });

  it("marks the active commerce route with aria-current=page", () => {
    pathname.current = "/build-progress";
    render(<SiteHeader />);

    const buildProgress = screen.getByRole("link", { name: "Build progress" });
    expect(buildProgress).toHaveAttribute("aria-current", "page");
    expect(buildProgress).toHaveAttribute("data-active", "true");

    // Non-active commerce links are not marked current.
    expect(screen.getByRole("link", { name: "Shop" })).not.toHaveAttribute("aria-current");
  });
});

describe("SiteHeader — brand mark", () => {
  it("renders the Convey brand link and logo image", () => {
    render(<SiteHeader />);

    const brand = screen.getByRole("link", { name: "Convey home" });
    expect(brand).toHaveAttribute("href", "/");

    const logo = brand.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("src", "/brand/convey-mark.png");
  });
});

describe("SiteHeader — consistent sticky light header on every route", () => {
  it("renders a sticky header (not fixed) so it is consistent on all routes", () => {
    for (const path of ["/", "/qr-ferry", "/build-progress"]) {
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
    for (const path of ["/", "/qr-ferry", "/build-progress"]) {
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
    // The wallet control renders in both the desktop and compact rails.
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
