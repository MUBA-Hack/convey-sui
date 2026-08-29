"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";

// Commerce is the only surface. Home ("/") is the commerce chat per the
// locked product rules; QR Ferry and Build progress land under their own
// routes. The wallet connection is the sole account control.
const COMMERCE_ITEMS = [
  { href: "/", label: "Shop" },
  { href: "/qr-ferry", label: "QR Ferry" },
  { href: "/build-progress", label: "Build progress" },
];

/**
 * The Convey mark — a fixed black raster at `public/brand/convey-mark.png`,
 * rendered via next/image. It is a single-tone black PNG on a transparent
 * background and does NOT inherit `currentColor`: it stays black regardless
 * of the surrounding text colour, so it is only visible on light grounds.
 * Sized in px via the `size` prop; the intrinsic source is high-resolution so
 * it stays crisp at the header's 26px and the home's larger placements.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <Image
      src="/brand/convey-mark.png"
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      priority
    />
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
        "top-0 z-[999] w-full sticky border-b border-[var(--cv-line)] bg-[var(--cv-paper)]/85 backdrop-blur-xl",
      )}
    >
      <div className="flex h-[60px] items-center justify-between gap-4 px-5 md:px-7">
        {/* Brand */}
        <Link
          href="/"
          aria-label="Convey home"
          className="flex shrink-0 items-center gap-2.5 text-black transition-colors"
        >
          <BrandMark size={26} />
          <span className="text-[19px] leading-none font-medium tracking-[-0.01em]">
            Convey
          </span>
        </Link>

        {/* Chip rail */}
        <div className="hidden items-center gap-[2px] lg:flex">
          {COMMERCE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-active={isActive(item.href) ? "true" : undefined}
              aria-current={isActive(item.href) ? "page" : undefined}
              className="cv-nav-chip"
            >
              {item.label}
            </Link>
          ))}
          <WalletConnectButton />
        </div>

        {/* Compact rail */}
        <div className="flex items-center gap-[2px] lg:hidden">
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
        <nav className="flex flex-col gap-[2px] px-5 pb-5 lg:hidden bg-[var(--cv-paper)]/97">
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
