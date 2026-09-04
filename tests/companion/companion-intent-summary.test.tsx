// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanionIntentSummary } from "@/components/companion/companion-intent-summary";
import type { CompanionProposal } from "@/lib/companion/contracts";
import type { CompanionContact } from "@/lib/companion/memory";

const address = `0x${"a".repeat(64)}`;

const proposal: CompanionProposal = {
  toolId: "payments.propose",
  contactId: "dave",
  contactLabel: "Dave",
  amountMajor: "12",
  asset: "USDC",
  purpose: "dinner",
  requiresUserApproval: true,
};

const confirmedContact: CompanionContact = {
  id: "dave",
  displayName: "Dave",
  aliases: [],
  relationshipLabel: "friend",
  address,
  previousAddress: null,
  confirmation: "confirmed",
  confirmedAt: 1_700_000_000_000,
};

const inferredContact: CompanionContact = { ...confirmedContact, confirmation: "inferred", confirmedAt: null };

function renderSummary(
  overrides: {
    proposal?: Partial<CompanionProposal>;
    contact?: CompanionContact | null;
    onRequestRevision?: () => void;
  } = {},
) {
  return render(
    <CompanionIntentSummary
      proposal={{ ...proposal, ...overrides.proposal }}
      contact={overrides.contact === undefined ? confirmedContact : overrides.contact}
      onRequestRevision={overrides.onRequestRevision}
    />,
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.useRealTimers();
});

describe("CompanionIntentSummary", () => {
  it("shows only the exact understood terms for a complete proposal", () => {
    renderSummary();

    expect(screen.getByRole("region", { name: "Convey understood" })).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
    expect(screen.getByText("Saved, address confirmed")).toBeInTheDocument();
    expect(screen.getByText("12 USDC")).toBeInTheDocument();
    expect(screen.getByText("dinner")).toBeInTheDocument();
    expect(screen.getByText("You review and approve")).toBeInTheDocument();
  });

  it("reports Not specified instead of inventing a missing purpose", () => {
    renderSummary({ proposal: { purpose: null } });

    expect(screen.getByText("Not specified")).toBeInTheDocument();
    expect(screen.queryByText("dinner")).toBeNull();
  });

  it("reflects saved-contact identity exactly as device memory holds it", () => {
    renderSummary({ contact: inferredContact });
    expect(screen.getByText("Saved, address not confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Saved, address confirmed")).toBeNull();

    cleanup();
    renderSummary({ contact: null });
    expect(screen.queryByText(/^Saved,/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show recipient address" })).toBeNull();
  });

  it("keeps the full address out of the thread until an explicit reveal, then copies it", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderSummary();
    expect(screen.queryByText(address)).not.toBeInTheDocument();

    const reveal = screen.getByRole("button", { name: "Show recipient address" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reveal);

    const hide = screen.getByRole("button", { name: "Hide recipient address" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(address)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy recipient address" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(writeText).toHaveBeenCalledWith(address);
    expect(screen.getByRole("button", { name: "Copy recipient address" })).toHaveTextContent("Copied");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole("button", { name: "Copy recipient address" })).toHaveTextContent(/^Copy$/);
  });

  it("keeps Copy honest when the clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "Show recipient address" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy recipient address" }));
    });
    expect(screen.getByRole("button", { name: "Copy recipient address" })).toHaveTextContent(/^Copy$/);
  });

  it("never claims the payment is safe, sent, executed, approved, or verified", () => {
    const { container } = renderSummary();

    const text = container.textContent ?? "";
    expect(text).toMatch(/Convey understood/);
    expect(text).toMatch(/You review and approve/);
    expect(text).not.toMatch(/\b(safe|sent|executed|verified|approved)\b/i);
  });

  it("offers an accessible correction action and no fake edit workflow without a target", () => {
    const onRequestRevision = vi.fn();
    renderSummary({ onRequestRevision });

    fireEvent.click(screen.getByRole("button", { name: "Change request" }));
    expect(onRequestRevision).toHaveBeenCalledTimes(1);

    cleanup();
    renderSummary();
    expect(screen.queryByRole("button", { name: "Change request" })).toBeNull();
  });
});
