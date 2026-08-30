"use client";

import { useState } from "react";
import { CommerceChat } from "@/components/commerce/commerce-chat";
import { RemittanceChat } from "@/components/remittance/remittance-chat";

/**
 * Pay workspace — the home route's single surface.
 *
 * Send abroad (the default, voice-first cross-border remittance money sheet)
 * dominates the first fold with no competing mode pills. Buy nearby (the
 * existing catalog purchase flow, unchanged) stays reachable only through a
 * quiet secondary link on the money sheet — never a competing first-fold
 * control. A quiet "Send abroad" link on the Buy side returns to the money
 * sheet. No new top-level route, demo page, or implementation-detail panel.
 */

type PayMode = "send" | "buy";

export function PayWorkspace() {
  const [mode, setMode] = useState<PayMode>("send");

  if (mode === "buy") {
    return (
      <div className="cv-shell mx-auto w-full max-w-[720px] px-4 pt-4 md:pt-6">
        <button
          type="button"
          data-testid="switch-to-send"
          onClick={() => setMode("send")}
          className="inline-flex min-h-[32px] items-center text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
        >
          Send abroad
        </button>
        <CommerceChat />
      </div>
    );
  }
  return <RemittanceChat onSwitchToBuy={() => setMode("buy")} />;
}
