"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ActivityItem as ActivityItemRecord } from "@/lib/activity/types";
import { ACTIVITY_PAGE_COPY } from "./activity-copy";
import { ActivityItemCard } from "./activity-item";

export function ActivityList({ items }: { items: readonly ActivityItemRecord[] }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.24;

  return (
    <div data-testid="activity-list" className="mx-auto w-full max-w-[760px]">
      <h1
        data-testid="activity-page-title"
        className="text-3xl font-normal tracking-[-0.04em] text-black sm:text-4xl"
      >
        {ACTIVITY_PAGE_COPY.title}
      </h1>
      <p
        data-testid="activity-page-intro"
        className="mt-2 text-[12px] leading-4 text-neutral-500"
      >
        {ACTIVITY_PAGE_COPY.listCaveat}
      </p>
      <ul className="mt-6 list-none border-t border-black/10 p-0">
        {items.map((item, index) => (
          <motion.li
            key={item.id}
            className="min-w-0 border-b border-black/10"
            initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration,
              delay: reduceMotion ? 0 : index * 0.045,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <ActivityItemCard item={item} />
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
