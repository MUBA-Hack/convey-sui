"use client";

import * as React from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { CornerPin, GridGuides, Hairline, ArrowUp, Eyebrow } from "./primitives";
import { useScrollFrame, clamp01, ease } from "./scroll-driver";

const NAVIGATION = [
  { href: "/", label: "Shop" },
  { href: "/qr-ferry", label: "QR Ferry" },
  { href: "/build-progress", label: "Build progress" },
];

/**
 * Section 9 — the deep-blue close.
 *
 * Carries the site's own links and the giant wordmark that rises into place
 * as the footer scrolls in (static under reduced motion, since the ride is
 * driven from the shared scroll loop).
 */
export function LandingFooter() {
  const markRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useScrollFrame(
    ({ scrollY, vh }) => {
      const mark = markRef.current;
      if (!mark) return;
      // The wordmark is the last thing on the page, so its ride is measured
      // against the remaining scroll: it lands exactly as the page bottoms out.
      const remaining = document.documentElement.scrollHeight - vh - scrollY;
      const p = ease(clamp01(1 - remaining / Math.max(1, vh * 0.8)));
      mark.style.transform = `translate3d(0, ${(1 - p) * 35}%, 0)`;
    },
    !reduce,
  );

  return (
    <footer
      data-header-theme="dark"
      className="cv-footer-ground cv-on-dark relative z-30 isolate overflow-hidden text-[#F3F3F3]"
    >
      <GridGuides columns={3} dark className="hidden md:block" />

      <div className="relative z-10 px-5 pt-24 md:px-7 md:pt-28">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-7">
          {/* Provenance — what the app settles on. */}
          <div className="relative lg:col-span-5">
            <CornerPin className="-top-6 left-0" />
            <div className="grid gap-9">
              <div>
                <Eyebrow className="text-[#F3F3F3]/50">Settled on</Eyebrow>
                <p className="cv-display mt-3 text-[clamp(1.9rem,3.4vw,2.75rem)]">
                  Sui
                </p>
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="grid gap-10 sm:grid-cols-2 lg:col-span-6 lg:col-start-7 lg:grid-cols-3">
            <FooterColumn heading="Navigation">
              {NAVIGATION.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-opacity hover:opacity-70">
                    {item.label}
                  </Link>
                </li>
              ))}
            </FooterColumn>

            <div className="flex items-start justify-start lg:justify-end">
              <a
                href="#top"
                className="group flex items-center gap-3"
                aria-label="Back to top"
              >
                <span className="cv-micro text-[#F3F3F3]/70">Back to top</span>
                <span className="grid size-[34px] place-items-center bg-[rgba(238,238,240,0.12)] transition-colors group-hover:bg-[var(--cv-accent)]">
                  <ArrowUp />
                </span>
              </a>
            </div>
          </div>
        </div>

        <Hairline dark className="mt-16" />

        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          <p className="cv-micro cv-micro-sm text-[#F3F3F3]/45">
            © 2026 Convey contributors
          </p>
        </div>
      </div>

      {/* The wordmark: sized to the full gutter width, cropped by the section's
          bottom edge, and riding up into place with the footer's scroll. */}
      <div className="relative mt-2 h-[8.6vw] min-h-[46px] overflow-hidden">
        <div ref={markRef} className="will-change-transform">
          <p
            aria-hidden
            className="cv-wordmark cv-display -mt-[0.05em] text-center text-[17.6vw] leading-[0.78] font-medium whitespace-nowrap"
          >
            Convey
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="cv-micro text-[#F3F3F3]/60">{heading}</h3>
      <ul className="mt-4 space-y-2.5 text-[17px] leading-snug">{children}</ul>
    </div>
  );
}
