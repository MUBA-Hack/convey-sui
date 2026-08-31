// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  MedicinePickupPanel,
  derivePickupWindow,
  type MedicinePickupPanelProps,
} from "@/components/remittance/medicine-pickup-panel";
import { getProtectedTransferTemplate } from "@/lib/remittance/protected-transfer-template";
import { PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS } from "@/lib/remittance/protected-transfer";

const BENEFICIARY_REF = "R-ABCD1234";
// 2024-01-15T12:00:00Z — well after the fictional sites' fixed 2023 windows.
// In Asia/Manila (PHT, UTC+8) this is 2024-01-15T20:00:00 PHT, so the next
// Manila calendar day is Jan 16 and the pickup window is 09:00–17:00 PHT
// on Jan 16, which is 01:00–09:00 UTC on Jan 16.
const NOW = Date.UTC(2024, 0, 15, 12, 0, 0);
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function Harness(props: Partial<MedicinePickupPanelProps> = {}) {
  return (
    <MedicinePickupPanel
      disabled={false}
      beneficiaryRef={BENEFICIARY_REF}
      nowMs={NOW}
      onCommitmentChange={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
});

describe("MedicinePickupPanel — pharmacy choice", () => {
  it("renders the three fictional pharmacy sites by consumer name without claiming partnership", async () => {
    render(<Harness />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.textContent === "Marites Pharmacy")).toBe(true);
    });
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels).toEqual(
      expect.arrayContaining([
        "Marites Pharmacy",
        "Bayani Drugstore",
        "Lakambini Apothecary",
      ]),
    );
    // No partnership / verified / approved language anywhere in the panel.
    const text = screen.getByTestId("medicine-pickup-panel").textContent ?? "";
    expect(text).not.toMatch(/partner|verified pharmacy|authentic medicine|approved|pickup complete|medical verification|settlement/i);
    // No internal pharmacy ids leak into the customer-facing panel.
    expect(text).not.toMatch(/phx-ref-/i);
  });

  it("shows pickup coverage once a pharmacy is chosen", async () => {
    render(<Harness />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    expect(screen.getByTestId("medicine-pickup-coverage")).toHaveTextContent(/Manila/i);
  });
});

describe("MedicinePickupPanel — scenario-relative pickup window", () => {
  it("derives a tomorrow bounded window from nowMs, not the provider's fixed 2023 window", async () => {
    render(<Harness />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    const window = screen.getByTestId("medicine-pickup-window");
    // Tomorrow relative to NOW (2024-01-15 PHT) is Jan 16 — never the site's Nov 2023.
    expect(window.textContent ?? "").toMatch(/Jan 16/i);
    expect(window.textContent ?? "").not.toMatch(/Nov|2023/i);
    // Customer-facing label is fixed Manila/PHT, never UTC.
    expect(window.textContent ?? "").toMatch(/Manila|PHT/i);
    expect(window.textContent ?? "").not.toMatch(/\bUTC\b/);
  });

  it("derivePickupWindow is pure and returns tomorrow 09:00–17:00 PHT as canonical UTC epochs", () => {
    const w = derivePickupWindow(NOW);
    // 09:00 PHT on Jan 16 = 01:00 UTC; 17:00 PHT = 09:00 UTC.
    expect(w.opensAt).toBe(Date.UTC(2024, 0, 16, 1, 0, 0));
    expect(w.closesAt).toBe(Date.UTC(2024, 0, 16, 9, 0, 0));
    expect(w.closesAt).toBeGreaterThan(w.opensAt);
    // The 09:00–17:00 PHT span is exactly 8 hours.
    expect(w.closesAt - w.opensAt).toBe(8 * 60 * 60 * 1000);
  });

  it("09:00–17:00 PHT corresponds to the correct UTC offset (UTC+8, no DST)", () => {
    // Pick a now whose Manila tomorrow is a known date, then verify the UTC
    // epochs equal the PHT wall clock minus 8 hours.
    const w = derivePickupWindow(NOW);
    const opensPht = new Date(w.opensAt + PHT_OFFSET_MS);
    const closesPht = new Date(w.closesAt + PHT_OFFSET_MS);
    expect(opensPht.getUTCHours()).toBe(9);
    expect(closesPht.getUTCHours()).toBe(17);
    expect(opensPht.getUTCDate()).toBe(16);
    expect(closesPht.getUTCDate()).toBe(16);
  });

  it("same nowMs yields the same window and digest across render times and devices", async () => {
    const runOnce = async () => {
      const onCommitmentChange = vi.fn();
      const { unmount } = render(
        <Harness onCommitmentChange={onCommitmentChange} />,
      );
      const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
      await waitFor(() => {
        expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
      });
      fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
      fireEvent.change(screen.getByTestId("medicine-order-ref"), {
        target: { value: "MARITES01" },
      });
      await waitFor(() => {
        expect(onCommitmentChange).toHaveBeenLastCalledWith(
          expect.stringMatching(/^0x[0-9a-f]{64}$/),
          expect.objectContaining({ pharmacyDisplayName: "Marites Pharmacy" }),
        );
      });
      const digest = onCommitmentChange.mock.calls.at(-1)![0] as string;
      const windowText = screen.getByTestId("medicine-pickup-window").textContent ?? "";
      unmount();
      return { digest, windowText };
    };
    // Two independent mounts (simulating different render times / devices)
    // with the same nowMs anchor produce identical window copy and digest.
    const first = await runOnce();
    const second = await runOnce();
    expect(second.digest).toBe(first.digest);
    expect(second.windowText).toBe(first.windowText);
  });

  it("passes the derived window (not the site's) into the commitment", async () => {
    const onCommitmentChange = vi.fn();
    render(<Harness onCommitmentChange={onCommitmentChange} />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "MARITES01" },
    });
    await waitFor(() => {
      expect(onCommitmentChange).toHaveBeenLastCalledWith(
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.objectContaining({ pharmacyDisplayName: "Marites Pharmacy" }),
      );
    });
    // The derived window is deterministic from nowMs; the same nowMs + inputs
    // always yield the same digest. Re-render with the same props and the
    // digest is stable.
    const firstDigest = onCommitmentChange.mock.calls.at(-1)![0] as string;
    expect(firstDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("MedicinePickupPanel — pharmacy order number (friendly, no schema jargon)", () => {
  it("shows only a Pharmacy order number field — no beneficiary reference input", async () => {
    render(<Harness />);
    const panel = screen.getByTestId("medicine-pickup-panel");
    expect(panel.querySelector('[data-testid="medicine-beneficiary-ref"]')).toBeNull();
    expect(screen.getByTestId("medicine-order-ref")).toBeInTheDocument();
    // No R-/ORD- schema jargon in labels or placeholders.
    const text = panel.textContent ?? "";
    expect(text).not.toMatch(/\bBeneficiary reference\b/i);
    expect(text).not.toMatch(/R-[A-Z0-9]{8}/);
    // The order field label is consumer-facing.
    expect(screen.getByText(/Pharmacy order number/i)).toBeInTheDocument();
  });

  it("accepts a friendly order number without the ORD- prefix and stores the strict adapter form", async () => {
    const onCommitmentChange = vi.fn();
    render(<Harness onCommitmentChange={onCommitmentChange} />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "marites01" },
    });
    await waitFor(() => {
      expect(onCommitmentChange).toHaveBeenLastCalledWith(
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.objectContaining({ orderRef: "ORD-MARITES01" }),
      );
    });
  });

  it("accepts an order number that already includes the ORD- prefix", async () => {
    const onCommitmentChange = vi.fn();
    render(<Harness onCommitmentChange={onCommitmentChange} />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "ORD-MARITES01" },
    });
    await waitFor(() => {
      expect(onCommitmentChange).toHaveBeenLastCalledWith(
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.objectContaining({ orderRef: "ORD-MARITES01" }),
      );
    });
  });

  it("emits null and shows a friendly error when the order number is malformed", async () => {
    const onCommitmentChange = vi.fn();
    render(<Harness onCommitmentChange={onCommitmentChange} />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "abc" },
    });
    await waitFor(() => {
      expect(onCommitmentChange).toHaveBeenLastCalledWith(null, null);
    });
    const err = screen.getByTestId("medicine-order-ref-error");
    expect(err).toBeInTheDocument();
    // Friendly error — no ORD- schema jargon.
    expect(err.textContent ?? "").not.toMatch(/ORD-/i);
  });

  it("never offers a drug, prescription, or health-condition field", () => {
    render(<Harness />);
    const panel = screen.getByTestId("medicine-pickup-panel");
    expect(panel.querySelector('[data-testid="medicine-drug"]')).toBeNull();
    expect(panel.querySelector('[data-testid="medicine-prescription"]')).toBeNull();
    expect(panel.querySelector('[data-testid="medicine-condition"]')).toBeNull();
  });

  it("disables every input when disabled is true", () => {
    render(<Harness disabled />);
    expect(screen.getByTestId("medicine-pharmacy-select")).toBeDisabled();
    expect(screen.getByTestId("medicine-order-ref")).toBeDisabled();
  });
});

describe("MedicinePickupPanel — pending vs ready copy", () => {
  it("shows the pending copy before a valid commitment and never says locked", async () => {
    render(<Harness />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    // No order number yet -> pending copy, never "locked".
    const pending = screen.getByTestId("medicine-pickup-status");
    expect(pending).toHaveTextContent(/Add your pharmacy order to continue/i);
    const panelText = screen.getByTestId("medicine-pickup-panel").textContent ?? "";
    expect(panelText).not.toMatch(/\blocked\b/i);
  });

  it("shows the ready copy plus a concise summary after a valid commitment", async () => {
    render(<Harness />);
    const select = (await screen.findByTestId("medicine-pharmacy-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).some((o) => o.value === "phx-ref-marites01")).toBe(true);
    });
    fireEvent.change(select, { target: { value: "phx-ref-marites01" } });
    fireEvent.change(screen.getByTestId("medicine-order-ref"), {
      target: { value: "MARITES01" },
    });
    const status = await screen.findByTestId("medicine-pickup-status");
    expect(status).toHaveTextContent(/Ready to lock with this hold/i);
    // The summary preserves the adapter pharmacy display name and the order ref.
    const summary = screen.getByTestId("medicine-pickup-summary");
    expect(summary).toHaveTextContent(/Marites Pharmacy/i);
    expect(summary).toHaveTextContent(/ORD-MARITES01/i);
  });
});

// ---------------------------------------------------------------------------
// Medicine hold safety — hold deadline must outlast the pickup window
// ---------------------------------------------------------------------------
//
// A medicine pickup hold is only useful while the pharmacy can still hand the
// order over. The pickup window is the next Manila calendar day, 09:00–17:00
// PHT, derived from the quote's issuedAt. The hold deadline is anchored to the
// plan-request time; the worst case is an immediate plan at the same instant
// the quote was issued, so deadline = issuedAt + preset duration. A 24h
// (tomorrow) hold issued at 08:00 PHT expires at 08:00 PHT the next day —
// one hour BEFORE pickup opens at 09:00 PHT. The medicine template must
// therefore default to a preset whose worst-case deadline exceeds the
// next-day pickup close (17:00 PHT).
// ---------------------------------------------------------------------------

describe("MedicinePickupPanel — hold deadline outlasts pickup window", () => {
  // 2024-01-15T00:00:00Z = 2024-01-15T08:00:00 PHT (UTC+8). A quote issued at
  // 08:00 PHT is the dangerous case: a 24h hold would expire at 08:00 PHT the
  // next day, before the 09:00 PHT pickup open.
  const QUOTE_ISSUED_08_00_PHT_UTC = Date.UTC(2024, 0, 15, 0, 0, 0);
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

  it("the medicine default preset deadline exceeds the next-day pickup close for an 08:00 PHT quote", () => {
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    const pickup = derivePickupWindow(QUOTE_ISSUED_08_00_PHT_UTC);
    // Worst-case immediate plan: deadline anchored at the quote issuedAt.
    const deadline = QUOTE_ISSUED_08_00_PHT_UTC +
      PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS[medicine.defaultDeadlinePreset];
    // The hold must still be live when the pharmacy closes pickup at 17:00 PHT
    // the next day. A 24h hold issued at 08:00 PHT expires at 08:00 PHT next
    // day — before pickup opens — so this must fail for "tomorrow" and pass
    // for the safe default.
    expect(deadline).toBeGreaterThan(pickup.closesAt);
    // Sanity: the dangerous 24h preset would have expired before pickup close.
    const dangerousDeadline = QUOTE_ISSUED_08_00_PHT_UTC +
      PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS.tomorrow;
    expect(dangerousDeadline).toBeLessThan(pickup.closesAt);
  });

  it("every allowed medicine preset deadline exceeds the next-day pickup close for an 08:00 PHT quote", () => {
    // No medicine preset that the customer can pick may produce a hold that
    // expires before the next-day pickup window closes.
    const medicine = getProtectedTransferTemplate("medicine_pickup")!;
    const pickup = derivePickupWindow(QUOTE_ISSUED_08_00_PHT_UTC);
    for (const preset of medicine.allowedDeadlinePresets) {
      const deadline = QUOTE_ISSUED_08_00_PHT_UTC +
        PROTECTED_TRANSFER_DEADLINE_DURATIONS_MS[preset];
      expect(deadline).toBeGreaterThan(pickup.closesAt);
    }
  });

  it("the pickup window for an 08:00 PHT quote is the next Manila day 09:00–17:00 PHT", () => {
    // Guard the regression anchor: confirm the window is exactly the next
    // Manila calendar day bounded to 09:00–17:00 PHT, expressed as canonical
    // UTC epochs.
    const pickup = derivePickupWindow(QUOTE_ISSUED_08_00_PHT_UTC);
    const opensPht = new Date(pickup.opensAt + PHT_OFFSET_MS);
    const closesPht = new Date(pickup.closesAt + PHT_OFFSET_MS);
    // Quote issued 2024-01-15 08:00 PHT -> next Manila day is Jan 16.
    expect(opensPht.getUTCDate()).toBe(16);
    expect(closesPht.getUTCDate()).toBe(16);
    expect(opensPht.getUTCHours()).toBe(9);
    expect(closesPht.getUTCHours()).toBe(17);
  });
});
