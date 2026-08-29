import Link from "next/link";

/**
 * Convey footer — compact black-and-white close.
 *
 * A minimal monochrome strip: the wordmark, the three commerce routes, a
 * back-to-top anchor, and the copyright line. No blue gradient, no giant
 * scrolling wordmark, no marketing block. Black ground, white type, hairline
 * rule. This is presentation only — it carries no functional or security
 * logic.
 */
const NAVIGATION = [
  { href: "/", label: "Shop" },
  { href: "/qr-ferry", label: "QR Ferry" },
  { href: "/build-progress", label: "Build progress" },
];

function ArrowUp({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13.5V3M3.75 7 8 2.75 12.25 7" />
    </svg>
  );
}

export function LandingFooter() {
  return (
    <footer className="relative z-30 border-t border-black/40 bg-black text-white">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-5 py-8 md:px-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          {/* Wordmark + tagline */}
          <div className="flex flex-col gap-1.5">
            <Link
              href="/"
              aria-label="Convey home"
              className="flex items-center gap-2 text-white transition-opacity hover:opacity-80"
            >
              <span className="text-[17px] font-medium tracking-[-0.01em]">
                Convey
              </span>
            </Link>
            <p className="text-xs text-white/55">
              Say it. Carry it across. Settle on Sui.
            </p>
          </div>

          {/* Navigation */}
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {NAVIGATION.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-white/75 transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="h-px w-full bg-white/15" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-white/45">
            © 2026 Convey contributors
          </p>
          <a
            href="#top"
            className="group inline-flex items-center gap-2 text-xs text-white/60 transition-colors hover:text-white"
            aria-label="Back to top"
          >
            Back to top
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/20 transition-colors group-hover:border-white/50">
              <ArrowUp />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
