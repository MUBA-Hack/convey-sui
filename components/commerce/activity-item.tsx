"use client";

import Link from "next/link";
import { ArrowRight2 } from "@/components/icons";
import type { ActivityItem as ActivityItemRecord } from "@/lib/activity/types";
import { ACTIVITY_PAGE_COPY } from "./activity-copy";

export function ActivityItemCard({ item }: { item: ActivityItemRecord }) {
  return (
    <Link
      href={item.href}
      data-testid="activity-item-cta"
      aria-label={`${ACTIVITY_PAGE_COPY.openReceipt}: ${item.title}, ${item.amountLabel}`}
      className="group flex min-h-11 min-w-0 items-center gap-4 py-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:gap-6 sm:py-6"
    >
      <article
        data-testid="activity-item"
        data-activity-id={item.id}
        className="flex min-w-0 flex-1 items-center justify-between gap-4 sm:gap-6"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-5 tracking-[-0.02em] text-neutral-950">
            {item.title}
          </p>
          <p
            data-testid="activity-item-nav"
            className="mt-1 truncate text-[12px] leading-4 text-neutral-500"
          >
            {item.detailLabel}
            <span aria-hidden="true"> · </span>
            {ACTIVITY_PAGE_COPY.savedPlanPrefix}: {item.nextOwner}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <p
            data-testid="activity-item-amount"
            className="text-[22px] font-semibold leading-none tracking-[-0.03em] text-black tabular-nums sm:text-[30px]"
          >
            {item.amountLabel}
          </p>
          <ArrowRight2
            size="16"
            variant="Linear"
            aria-hidden="true"
            className="shrink-0 text-neutral-400 transition-transform transition-colors duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 group-hover:text-black motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          />
        </div>
      </article>
    </Link>
  );
}
