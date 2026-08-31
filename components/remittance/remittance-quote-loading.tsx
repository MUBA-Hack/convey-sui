"use client";

/**
 * In-place quote-loading state.
 *
 * While the quote service resolves, the settlement ticket's destination slot
 * shows this skeleton instead of the entry money sheet or a populated quote.
 * It mirrors the resolved `RemittanceQuotePreview` two-group layout so the
 * handoff from "Locking your rate…" to the populated ticket is a content swap,
 * not a layout jump: same outer sheet, same grid, same recipient chip seat,
 * same black amount band, same summary-row rhythm, same right-group action
 * seat. Populated amounts, fee, rate, and the countdown are suppressed by
 * construction — the skeleton holds neutral bars only.
 *
 * Motion is functional, not decorative: one `cv-tick` pulse on the status dot
 * signals liveness; skeleton bars carry `cv-shimmer` for a restrained sweep.
 * The global `prefers-reduced-motion` block already zeroes animation duration
 * and hides `cv-shimmer::after`, so reduced-motion users see a static skeleton
 * (still visually distinct from a loaded ticket: no numbers, no countdown).
 *
 * Accessible status: the visible "Locking your rate…" line is also the AT
 * status (role=status, aria-live=polite). The decorative bars and dot are
 * aria-hidden. The container carries aria-busy so AT users know the region is
 * pending. No detached sighted banner.
 */
export function RemittanceQuoteLoading() {
  return (
    <div
      data-testid="remittance-quote-loading"
      aria-busy="true"
      aria-label="Quote is being prepared"
      className="cv-money-sheet cv-preview-in mt-3 overflow-hidden rounded-2xl"
    >
      <div
        data-testid="quote-workspace-grid"
        className="lg:grid lg:grid-cols-[minmax(0,56fr)_minmax(0,44fr)] lg:items-start lg:gap-0"
      >
        {/* Left group — recipient chip, black amount band, summary rows,
            corridor footer. Same seats as the resolved preview. */}
        <div className="lg:flex lg:flex-col lg:self-stretch lg:border-r lg:border-black/8">
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <span aria-hidden className="cv-contact-portrait shrink-0">
              <span className="cv-contact-portrait__head" />
              <span className="cv-contact-portrait__body" />
            </span>
            <div className="min-w-0 flex-1">
              <span
                aria-hidden
                className="cv-shimmer relative block h-3.5 w-28 overflow-hidden rounded-full bg-neutral-200"
              />
              <span
                aria-hidden
                className="cv-shimmer relative mt-1.5 block h-2.5 w-20 overflow-hidden rounded-full bg-neutral-200"
              />
            </div>
          </div>

          {/* Black amount band — same frame as the resolved money slab, with
              neutral bars where the send / receive amounts will land. */}
          <div
            aria-hidden
            className="cv-money-tile mx-4 grid gap-4 rounded-[18px] bg-black p-4 text-white sm:grid-cols-2 sm:gap-0 sm:p-5 lg:mx-5"
          >
            <div className="sm:border-r sm:border-white/12 sm:pr-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
                You send
              </p>
              <span className="mt-1 block h-7 w-32 rounded-full bg-white/15" />
            </div>
            <div className="border-t border-white/12 pt-3 sm:border-t-0 sm:pt-0 sm:pl-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
                Estimated receive
              </p>
              <span className="mt-1 block h-7 w-36 rounded-full bg-white/15" />
            </div>
          </div>

          {/* Summary rows — fee / rate / rate-locked-for seats, neutral bars
              only. No countdown is rendered while loading. */}
          <dl
            aria-hidden
            className="space-y-2.5 px-4 pt-3 pb-3 text-sm"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="block h-2.5 w-24 rounded-full bg-neutral-200" />
                <span className="block h-2.5 w-16 rounded-full bg-neutral-200" />
              </div>
            ))}
          </dl>

          {/* Corridor footer seat — anchors the left group's lower band on
              desktop, mirroring the resolved preview. */}
          <p aria-hidden className="mt-auto px-4 pb-4 pt-2">
            <span className="block h-2.5 w-24 rounded-full bg-neutral-200" />
          </p>
        </div>

        {/* Right group — the live "Locking your rate…" status, the truth line,
            and the action seat. This is the only sighted loading affordance. */}
        <div className="lg:flex lg:flex-col lg:pt-4">
          <div className="flex items-center gap-2 px-4 pb-3">
            <span
              aria-hidden
              className="cv-tick inline-block h-2 w-2 rounded-full bg-black"
            />
            <p
              data-testid="quote-loading-status"
              role="status"
              aria-live="polite"
              className="text-[12px] font-medium text-black"
            >
              Locking your rate…
            </p>
          </div>

          <p className="px-4 pb-3 text-[11px] leading-relaxed text-neutral-500">
            Reference FX · no MYR charge until you approve.
          </p>

          {/* Action seat — neutral bars where Review transfer / Edit will
              land. No enabled control is offered while loading. */}
          <div aria-hidden className="space-y-2 px-4 pb-4">
            <span className="block h-11 w-full rounded-xl bg-neutral-200" />
            <span className="block h-9 w-40 rounded-lg bg-neutral-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
