"use client";

import { useState } from "react";
import { loadAiDecisionReceipts } from "@/lib/activity/ai-decision-receipt";
import { loadActivity } from "@/lib/activity/storage";
import { AiDecisionReceiptRow } from "./ai-decision-receipt";
import { ActivityEmpty } from "./activity-empty";
import { ActivityList } from "./activity-list";

/**
 * No-query /proof surface. Loads device-local convenience history through the
 * Activity storage API. Local records never upgrade proof; opening an item
 * reuses the existing receipt URL and verifier.
 *
 * Lazy client state: this panel mounts only after ProofVerifier finishes URL
 * inspection on the client, so `loadActivity` runs in the state initializer
 * and never as a synchronous effect update.
 */
export function ActivityPanel() {
  const [items] = useState(loadActivity);
  const [aiReceipts] = useState(loadAiDecisionReceipts);
  if (items.length === 0 && aiReceipts.length === 0) return <ActivityEmpty />;

  return (
    <div className="mx-auto w-full max-w-[760px]">
      {items.length > 0 ? (
        <ActivityList items={items} />
      ) : (
        <header>
          <span className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Activity
          </span>
          <h1 className="mt-2 text-3xl font-normal tracking-[-0.04em] text-black sm:text-4xl">
            Recent activity.
          </h1>
        </header>
      )}

      {aiReceipts.length > 0 ? (
        <section aria-labelledby="ai-checks-title" className="mt-10 border-t border-black/10 pt-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Independent records
              </p>
              <h2 id="ai-checks-title" className="mt-1 text-xl tracking-[-0.03em] text-black">
                AI checks
              </h2>
            </div>
            <p className="max-w-[220px] text-right text-[11px] leading-4 text-neutral-500">
              Public routing details, checked when opened.
            </p>
          </div>
          <div className="grid gap-3">
            {aiReceipts.map((receipt) => (
              <AiDecisionReceiptRow key={receipt.requestId} record={receipt} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
