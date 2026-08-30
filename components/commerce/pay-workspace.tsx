"use client";

import { useState } from "react";
import { CommerceChat } from "@/components/commerce/commerce-chat";
import { RemittanceChat } from "@/components/remittance/remittance-chat";

/**
 * Pay workspace — the home route's single surface for choosing what to pay for.
 *
 * Two modes share the existing Pay nav entry:
 *  - "send"  (default) — Send abroad: voice-first cross-border remittance with
 *                        transparent fees and Sui USDC settlement.
 *  - "buy"            — Buy nearby: the existing catalog purchase flow,
 *                        unchanged and fully functional.
 *
 * The default is "send" so a fresh viewer understands in ten seconds that
 * Convey is voice-first cross-border remittance. No new top-level route, demo
 * page, or implementation-detail panel is added.
 */

type PayMode = "send" | "buy";

const MODE_TABS: { key: PayMode; label: string }[] = [
  { key: "send", label: "Send abroad" },
  { key: "buy", label: "Buy nearby" },
];

export function PayWorkspace() {
  const [mode, setMode] = useState<PayMode>("send");

  return (
    <div className="cv-shell__ground flex min-h-[calc(100vh-60px)] flex-col">
      <div className="mx-auto w-full max-w-[1120px] px-4 pt-3 md:pt-6">
        <div
          role="tablist"
          aria-label="Pay mode"
          className="inline-flex items-center gap-[2px] rounded-xl border border-black/10 bg-white p-1"
        >
          {MODE_TABS.map((tab) => {
            const active = mode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-pay-mode={tab.key}
                data-active={active ? "true" : undefined}
                onClick={() => setMode(tab.key)}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "bg-black text-white"
                    : "bg-transparent text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "send" ? <RemittanceChat /> : <CommerceChat />}
    </div>
  );
}
