"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";

const COMMERCE_ITEMS = [
  { href: "/app", label: "Assistant", description: "Ask Convey" },
  { href: "/pay", label: "Pay", description: "Send money nearby or abroad" },
  {
    href: "/qr-ferry",
    label: "Continue elsewhere",
    description: "Carry a quote to another device",
  },
  { href: "/proof", label: "Activity", description: "Review recent transfers" },
  {
    href: "/strategy",
    label: "Treasury",
    description: "Explore separate market protection",
  },
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
        "site-header top-0 z-[999] w-full sticky border-b border-[var(--cv-line)] bg-[var(--cv-paper)]/85 backdrop-blur-xl",
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

        <div className="flex items-center gap-[2px]">
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
          aria-label="Convey journeys"
          className="flex flex-col gap-[2px] bg-[var(--cv-paper)]/97 px-5 pb-5 md:ml-auto md:max-w-[420px] md:px-8"
        >
          {COMMERCE_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className="cv-nav-chip !h-auto min-h-14 !justify-between gap-4 py-2.5 text-left"
                onClick={toggleMenu}
              >
                <span>{item.label}</span>
                <span className="font-sans text-[11px] font-normal normal-case tracking-normal text-neutral-500">
                  {item.description}
                </span>
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
