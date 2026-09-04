"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Send2 } from "@/components/icons";
import { ACTIVITY_PAGE_COPY } from "./activity-copy";

export function ActivityEmpty() {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0.01 : 0.24;

  return (
    <motion.div
      data-testid="activity-empty"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-stretch"
    >
      <div className="flex min-w-0 flex-col justify-center">
        <span className="inline-flex w-fit items-center rounded-full border border-black/15 bg-white px-3 py-1 font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700">
          {ACTIVITY_PAGE_COPY.eyebrow}
        </span>
        <h1
          data-testid="activity-page-title"
          className="mt-4 text-4xl font-normal tracking-[-0.05em] text-black sm:text-5xl"
        >
          {ACTIVITY_PAGE_COPY.title}
        </h1>
        <p
          data-testid="activity-page-intro"
          className="mt-4 max-w-md text-sm leading-6 text-neutral-600 sm:text-base"
        >
          {ACTIVITY_PAGE_COPY.intro}
        </p>
      </div>

      <div
        data-testid="activity-empty-slab"
        className="flex min-h-[240px] flex-col justify-between rounded-[18px] bg-black p-6 text-white sm:min-h-[280px] sm:p-7"
      >
        <div>
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Next step
          </p>
          <h2 className="mt-3 text-2xl tracking-[-0.04em] sm:text-3xl">
            {ACTIVITY_PAGE_COPY.emptyTitle}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
            {ACTIVITY_PAGE_COPY.emptyBody}
          </p>
        </div>
        <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href="/"
            data-testid="activity-send-money"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-xs font-semibold uppercase tracking-[0.12em] text-black transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
          >
            <Send2 size="15" variant="Linear" aria-hidden="true" />
            {ACTIVITY_PAGE_COPY.sendMoney}
          </Link>
          <Link
            href="/proof/reference"
            data-testid="activity-open-example"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold uppercase tracking-[0.12em] text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
          >
            {ACTIVITY_PAGE_COPY.openExample}
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
