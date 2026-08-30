"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";

// Commerce is the only surface. Home ("/") is the commerce chat per the
// locked product rules; Pay offline, Protect, and Verify land under their
// own routes. The wallet connection is the sole account control.
const COMMERCE_ITEMS = [
  { href: "/", label: "Pay" },
  { href: "/qr-ferry", label: "Pay offline" },
  { href: "/strategy", label: "Protect" },
  { href: "/proof", label: "Verify" },
];

/**
 * The Convey mark — a bold filled monochrome app icon: a black squircle
 * carrier with a white crossing route (an open carry arc + a through-arrow),
 * suggesting value carried across. Inline SVG; the source also lives at
 * `public/brand/convey-mark.svg`. Ownable at 28–30px.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      data-testid="convey-mark"
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="14" fill="#000" />
      <path
        d="M21.8 10.8A8 8 0 1 0 21.8 21.2"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M10 16h12"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="m18.8 12.8 3.5 3.2-3.5 3.2"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  // The Pay homepage is a focused amount-first surface: the full
  // Pay/Pay offline/Protect/Verify desktop chip rail is hidden there so the
  // first frame reads as one product, not a lab sitemap. Brand, Sign in, and
  // a compact menu keep every other product area one tap away. Routes are
  // not removed — they remain in the mobile/compact sheet and on every other
  // route's desktop rail.
  const isPayHome = pathname === "/";

  // The sheet is keyed to the route it was opened on, so navigating away
  // closes it without an effect fighting React's render pass.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const menuOpen = openedOnPath === pathname;
  const toggleMenu = () =>
    setOpenedOnPath((prev) => (prev === pathname ? null : pathname));

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={cn(
        "top-0 z-[999] w-full sticky border-b border-[var(--cv-line)] bg-[var(--cv-paper)]/85 backdrop-blur-xl",
      )}
    >
      <div className="flex h-[68px] items-center justify-between gap-4 px-5 md:px-8">
        {/* Brand lockup — mark + wordmark aligned as one unit. The mark is a
            currentColor vector so it tracks the wordmark's black on light
            grounds. Stronger weight and tighter tracking read as a finance
            house, not a generic SaaS wordmark. */}
        <Link
          href="/"
          aria-label="Convey home"
          className="flex shrink-0 items-center gap-2.5 text-black transition-colors"
        >
          <BrandMark size={34} />
          <span className="flex flex-col">
            <span className="text-[23px] leading-none font-semibold tracking-[-0.035em]">Convey</span>
            <span className="mt-1 hidden font-narrow text-[8px] font-semibold uppercase tracking-[0.2em] text-neutral-500 sm:block">
              Move with intent
            </span>
          </span>
        </Link>

        {/* Full desktop chip rail — hidden on the Pay homepage so the amount
            card dominates the first frame. On every other route, Pay stays
            primary and Pay offline/Protect/Verify are quieter secondary
            destinations. Routes, names, and active state are unchanged. */}
        {!isPayHome && (
          <div className="hidden items-center gap-[2px] lg:flex">
            {COMMERCE_ITEMS.map((item) => {
              const active = isActive(item.href);
              const isPay = item.href === "/";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "cv-nav-chip",
                    !active && !isPay && "cv-nav-chip--quiet",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <WalletConnectButton />
          </div>
        )}

        {/* Compact rail — brand + Sign in + an accessible menu for the other
            product areas. On the Pay homepage this is the only desktop rail;
            on every route it is the mobile rail. */}
        <div
          className={cn(
            "flex items-center gap-[2px]",
            isPayHome ? "flex" : "lg:hidden",
          )}
        >
          <WalletConnectButton />
          <button
            type="button"
            className="cv-nav-chip w-[34px] px-0"
            aria-expanded={menuOpen}
            aria-label="Toggle navigation menu"
            onClick={toggleMenu}
          >
            <span className="flex w-4 flex-col gap-[3px]" aria-hidden>
              <span
                className={cn(
                  "block h-[1.5px] w-full bg-current transition-transform duration-200",
                  menuOpen && "translate-y-[4.5px] rotate-45",
                )}
              />
              <span
                className={cn(
                  "block h-[1.5px] w-full bg-current transition-opacity duration-200",
                  menuOpen && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "block h-[1.5px] w-full bg-current transition-transform duration-200",
                  menuOpen && "-translate-y-[4.5px] -rotate-45",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          className={cn(
            "flex flex-col gap-[2px] px-5 pb-5 bg-[var(--cv-paper)]/97",
            // On the Pay homepage the sheet is the desktop menu too; otherwise
            // it stays the mobile-only sheet.
            isPayHome ? "" : "lg:hidden",
          )}
        >
          {COMMERCE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-active={isActive(item.href) ? "true" : undefined}
              className="cv-nav-chip !h-11 !justify-start"
              onClick={toggleMenu}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
