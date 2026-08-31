"use client";

import { useEffect, useMemo, useState } from "react";
import { createReferencePharmacyProvider } from "@/lib/pharmacy/reference-network";
import { prepareMedicineOrderCommitment } from "@/lib/pharmacy/medicine-order-commitment";
import type { MedicineOrderCommitmentSummary } from "@/lib/pharmacy/medicine-order-commitment";
import type { PharmacySite } from "@/lib/pharmacy/network";

/**
 * Medicine pickup panel — a progressive hold-purpose panel rendered inside the
 * hold path when the customer chooses Medicine pickup.
 *
 * Truth boundary: the customer picks a fictional reference pharmacy by its
 * consumer name and enters a friendly pharmacy order number. The beneficiary
 * reference is NOT entered here — it is threaded from the existing quote
 * (`quote.beneficiaryRef`) so the customer never sees R-/ORD- schema jargon.
 * The panel shows a scenario-relative pickup window derived from `nowMs`
 * (tomorrow, bounded, locale-independent UTC) — never the provider's fixed
 * historical window. A valid entry prepares a privacy-minimal initial order
 * commitment via `prepareMedicineOrderCommitment` and emits its manifest digest
 * upward; the parent binds that digest into the existing Protected Transfer
 * plan request as `custodyManifestDigest`.
 *
 * No drug name, prescription body, health condition, person name, exact
 * location, photo, URL, secret, or wallet field is accepted. Pharmacy display
 * names are consumer names only; this panel never claims partnership,
 * verification, authenticity, approval, pickup completion, medical
 * verification, or settlement.
 */

const REFERENCE_SITE_IDS = [
  "phx-ref-marites01",
  "phx-ref-bayani04",
  "phx-ref-lakambini07",
] as const;

// Scenario-relative pickup window: tomorrow, 09:00–17:00 in Asia/Manila (PHT).
// PHT is UTC+8 year-round (no DST), so the offset is a fixed constant and the
// conversion is deterministic without any locale- or host-dependent Intl
// timezone lookup. Canonical UTC epochs are stored; the customer-facing label
// always reads "Manila/PHT" regardless of host locale or timezone.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PICKUP_OPEN_HOUR_PHT = 9;
const PICKUP_CLOSE_HOUR_PHT = 17;

/**
 * Pure, deterministic pickup window derived from `nowMs`: the next Manila
 * calendar day bounded to 09:00–17:00 PHT, returned as canonical UTC epochs.
 * Same `nowMs` always yields the same window. PHT has no DST, so the offset is
 * a fixed constant and the result is independent of host locale/timezone.
 * Exported for focused testing.
 */
export function derivePickupWindow(nowMs: number): {
  opensAt: number;
  closesAt: number;
} {
  // Manila wall-clock day index for `nowMs`: floor((nowMs + offset) / day).
  // Adding the offset shifts the UTC epoch into the PHT calendar before
  // counting days, so "tomorrow" is the next Manila calendar date.
  const manilaTodayIndex = Math.floor((nowMs + PHT_OFFSET_MS) / MS_PER_DAY);
  const tomorrowIndex = manilaTodayIndex + 1;
  // Midnight UTC of the Manila tomorrow date. 09:00 PHT = +1h UTC; 17:00 PHT
  // = +9h UTC (because PHT = UTC+8, so 09:00 PHT − 8h = 01:00 UTC).
  const tomorrowMidnightUtc = tomorrowIndex * MS_PER_DAY;
  const opensAt = tomorrowMidnightUtc + PICKUP_OPEN_HOUR_PHT * 60 * 60 * 1000 - PHT_OFFSET_MS;
  const closesAt = tomorrowMidnightUtc + PICKUP_CLOSE_HOUR_PHT * 60 * 60 * 1000 - PHT_OFFSET_MS;
  return { opensAt, closesAt };
}

// Locale-independent formatter: fixed locale + UTC zone so the wall-clock
// reading is identical regardless of host locale or timezone. The displayed
// zone is the fixed customer-facing "Manila/PHT" label, never the host zone.
const PICKUP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatPickupWindow(window: { opensAt: number; closesAt: number }): string {
  // Render in PHT wall clock by adding the fixed offset before formatting in
  // UTC, then label the zone as the customer-facing "Manila/PHT".
  const openPht = window.opensAt + PHT_OFFSET_MS;
  const closePht = window.closesAt + PHT_OFFSET_MS;
  return `${PICKUP_FORMATTER.format(openPht)} – ${PICKUP_FORMATTER.format(
    closePht,
  )} Manila/PHT`;
}

/**
 * Normalize a friendly pharmacy order number to the strict adapter form
 * `ORD-<8..16 upper alnum>`. Accepts input with or without the `ORD-` prefix,
 * trims, uppercases, and re-attaches the prefix. Returns null when the body
 * does not match the bounded adapter pattern. No schema jargon leaks to the
 * customer; the prefix is internal.
 */
function normalizeOrderRef(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  const body = trimmed.startsWith("ORD-") ? trimmed.slice(4) : trimmed;
  if (!/^[A-Z0-9]{8,16}$/.test(body)) return null;
  return `ORD-${body}`;
}

export interface MedicinePickupPanelProps {
  disabled: boolean;
  /** Beneficiary reference threaded from the existing quote (R-XXXXXXXX). */
  beneficiaryRef: string;
  /** Reference now for the scenario-relative pickup window. Defaults to now. */
  nowMs?: number;
  onCommitmentChange: (
    digest: string | null,
    summary: MedicineOrderCommitmentSummary | null,
  ) => void;
}

export function MedicinePickupPanel({
  disabled,
  beneficiaryRef,
  nowMs,
  onCommitmentChange,
}: MedicinePickupPanelProps) {
  const [sites, setSites] = useState<readonly PharmacySite[]>([]);
  const [pharmacyId, setPharmacyId] = useState<string>("");
  const [orderRefInput, setOrderRefInput] = useState<string>("");

  // Resolve the three fictional reference sites once, by consumer name. The
  // ids stay internal; only display names reach the customer.
  useEffect(() => {
    let cancelled = false;
    const provider = createReferencePharmacyProvider();
    void (async () => {
      const resolved: PharmacySite[] = [];
      for (const id of REFERENCE_SITE_IDS) {
        const r = await provider.resolvePharmacy(id);
        if (r.ok) resolved.push(r.site);
      }
      if (!cancelled) setSites(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === pharmacyId) ?? null,
    [sites, pharmacyId],
  );

  // Derive the scenario-relative pickup window from the reference now. The
  // provider's fixed historical window is never displayed or committed. The
  // reference now is captured once on mount: the parent's deterministic
  // `nowMs` (used by tests) or the current time in production.
  const [resolvedNow] = useState(() => nowMs ?? Date.now());
  const pickupWindow = useMemo(
    () => derivePickupWindow(resolvedNow),
    [resolvedNow],
  );

  const orderTouched = orderRefInput.length > 0;
  const strictOrderRef = normalizeOrderRef(orderRefInput);
  const orderError =
    orderTouched && strictOrderRef === null
      ? "Enter your pharmacy order number (8–16 letters or numbers)."
      : null;

  // Prepare a commitment whenever the selected site and a valid order number
  // are present. The beneficiary reference comes from the quote, not an input.
  // A malformed or incomplete entry emits (null, null) so the parent can fail
  // closed and keep the hold CTA disabled.
  useEffect(() => {
    if (!selectedSite || strictOrderRef === null) {
      onCommitmentChange(null, null);
      return;
    }
    const result = prepareMedicineOrderCommitment({
      site: selectedSite,
      beneficiaryRef,
      orderRef: strictOrderRef,
      startMs: pickupWindow.opensAt,
      endMs: pickupWindow.closesAt,
    });
    if (!result.ok) {
      onCommitmentChange(null, null);
      return;
    }
    onCommitmentChange(
      result.commitment.manifest.manifestDigest,
      result.commitment.summary,
    );
  }, [
    selectedSite,
    strictOrderRef,
    beneficiaryRef,
    pickupWindow.opensAt,
    pickupWindow.closesAt,
    onCommitmentChange,
  ]);

  const hasCommitment = Boolean(selectedSite) && strictOrderRef !== null;

  return (
    <div
      data-testid="medicine-pickup-panel"
      className="space-y-2 rounded-lg border border-black/10 bg-white p-2.5"
    >
      <p
        data-testid="medicine-pickup-status"
        className="text-[11px] leading-snug text-neutral-600"
      >
        {hasCommitment
          ? "Ready to lock with this hold"
          : "Add your pharmacy order to continue."}
      </p>

      <div className="space-y-1">
        <label
          htmlFor="medicine-pharmacy-select"
          className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500"
        >
          Pickup pharmacy
        </label>
        <select
          id="medicine-pharmacy-select"
          data-testid="medicine-pharmacy-select"
          disabled={disabled || sites.length === 0}
          value={pharmacyId}
          onChange={(e) => setPharmacyId(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-black/12 bg-white px-3 text-sm text-black outline-none focus-visible:ring-2 focus-visible:ring-black/40 disabled:opacity-50"
        >
          <option value="" disabled>
            {sites.length === 0 ? "Loading pharmacies…" : "Choose a pharmacy"}
          </option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.displayName}
            </option>
          ))}
        </select>
      </div>

      {selectedSite && (
        <div
          data-testid="medicine-pickup-coverage"
          className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-1.5 text-[11px]"
        >
          <span className="text-neutral-500">Pickup coverage</span>
          <span className="font-medium text-black">
            {selectedSite.coverage.city}, {selectedSite.coverage.country}
          </span>
        </div>
      )}

      {selectedSite && (
        <div
          data-testid="medicine-pickup-window"
          className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-1.5 text-[11px]"
        >
          <span className="text-neutral-500">Pickup window</span>
          <span className="font-medium tabular-nums text-black">
            {formatPickupWindow(pickupWindow)}
          </span>
        </div>
      )}

      <div className="space-y-1">
        <label
          htmlFor="medicine-order-ref"
          className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500"
        >
          Pharmacy order number
        </label>
        <input
          id="medicine-order-ref"
          data-testid="medicine-order-ref"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          value={orderRefInput}
          onChange={(e) => setOrderRefInput(e.target.value)}
          placeholder="e.g. MARITES01"
          aria-invalid={Boolean(orderError)}
          className="min-h-11 w-full rounded-lg border border-black/12 bg-white px-3 font-mono text-sm uppercase text-black outline-none focus-visible:ring-2 focus-visible:ring-black/40 disabled:opacity-50"
        />
        {orderError && (
          <p
            data-testid="medicine-order-ref-error"
            role="alert"
            className="text-[11px] text-neutral-700"
          >
            {orderError}
          </p>
        )}
      </div>

      {hasCommitment && selectedSite && strictOrderRef !== null && (
        <div
          data-testid="medicine-pickup-summary"
          className="rounded-md border border-black/10 bg-neutral-50 px-3 py-2 text-[11px] leading-snug text-neutral-700"
        >
          <p className="font-medium text-black">{selectedSite.displayName}</p>
          <p className="mt-0.5 tabular-nums">
            {strictOrderRef} · {formatPickupWindow(pickupWindow)}
          </p>
        </div>
      )}
    </div>
  );
}
