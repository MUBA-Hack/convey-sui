// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QrFerry, NONCE_STORAGE_KEY } from "@/components/commerce/qr-ferry";
import QrFerryPage from "@/app/qr-ferry/page";
import {
  createEnvelope,
  exportEnvelopeJson,
  type QrFerryEnvelope,
  type QrFerryEnvelopeInput,
} from "@/lib/commerce/qr-ferry";

/**
 * Wave 3 Task 3.2 UI — DOM tests pinning the Offline QR Ferry two-panel UI.
 *
 * The component renders two panels: an offline device that creates a
 * tamper-evident envelope from a safe demo purchase and renders a QR plus
 * copy/download payload, and a connected device that pastes/imports the
 * payload, validates it, reviews item/qty/SUI/address/expiry, consumes the
 * nonce once via a localStorage-backed ReplayRegistry, and exposes the
 * validated envelope to a future payment action integration (no transaction
 * code). Same payload visibly rejects replay; expired fixture rejects;
 * tampered payload rejects. LocalStorage survives refresh.
 *
 * Only the browser seams (clipboard, URL.createObjectURL, localStorage, the
 * clock) are mocked. The real qr-ferry lib (createEnvelope / importEnvelope /
 * exportEnvelopeJson) is exercised end-to-end.
 */

// Deterministic demo merchant address (valid Sui address: 32-byte hex).
const MERCHANT = "0x".concat("11".repeat(32)) as `0x${string}`;
const PAYER = "0x".concat("22".repeat(32)) as `0x${string}`;

const NOW = 1_700_000_000_000; // fixed "now" for deterministic tests
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/** Craft a valid envelope JSON with a given nonce and optional overrides. */
function craftJson(
  nonce: string,
  overrides: Partial<QrFerryEnvelopeInput> = {},
): string {
  const env = createEnvelope({
    item: "Iced Coffee",
    quantity: 2,
    totalMist: 6_000_000_000n, // 6 SUI
    merchantAddress: MERCHANT,
    nonce,
    createdAt: NOW,
    expiresAt: NOW + EXPIRY_MS,
    ...overrides,
  });
  return exportEnvelopeJson(env);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();

  // Mock clipboard.writeText (jsdom does not provide it).
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });

  // Mock URL.createObjectURL / revokeObjectURL (jsdom does not provide them).
  Object.defineProperty(globalThis.URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  cleanup();
});

// ---------------------------------------------------------------------------
// Structure and transport explanation
// ---------------------------------------------------------------------------

describe("QrFerry — structure and transport explanation", () => {
  it("renders both the Generate and Import panels", () => {
    render(<QrFerry />);
    expect(
      screen.getByRole("heading", { name: /Offline device/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Connected device/i }),
    ).toBeInTheDocument();
  });

  it("explains tamper-evident transport, not authorization", () => {
    render(<QrFerry />);
    const explanation = screen.getByTestId("transport-explanation");
    expect(explanation).toHaveTextContent(/tamper-evident/i);
    expect(explanation).toHaveTextContent(/not.*authorization/i);
    // Must not claim signature or authorization.
    expect(explanation).not.toHaveTextContent(/signed/i);
  });

  it("renders the page route with the main heading", () => {
    render(<QrFerryPage />);
    expect(
      screen.getByRole("heading", { name: /Offline QR Ferry/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Generate panel
// ---------------------------------------------------------------------------

describe("QrFerry — generate panel", () => {
  it("shows the safe demo purchase details before generating", () => {
    render(<QrFerry />);
    const generatePanel = screen.getByTestId("generate-panel");
    expect(generatePanel).toHaveTextContent(/Iced Coffee/i);
    expect(generatePanel).toHaveTextContent(/River Cafe/i);
    expect(generatePanel).toHaveTextContent(/2/); // quantity
    expect(generatePanel).toHaveTextContent(/6.*SUI/i); // total
  });

  it("renders a QR code and payload after clicking Generate", () => {
    const { container } = render(<QrFerry />);
    // No QR before generate.
    expect(container.querySelector("svg")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Generate envelope/i }));

    // QR SVG appears.
    expect(container.querySelector("svg")).not.toBeNull();
    // Payload text is visible and contains the item and merchant.
    const payload = screen.getByTestId("envelope-payload");
    expect(payload).toHaveTextContent(/Iced Coffee/);
    expect(payload).toHaveTextContent(MERCHANT);
  });

  it("copies the payload to the clipboard", () => {
    render(<QrFerry />);
    fireEvent.click(screen.getByRole("button", { name: /Generate envelope/i }));

    const copyBtn = screen.getByRole("button", { name: /Copy payload/i });
    fireEvent.click(copyBtn);

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = vi.mocked(globalThis.navigator.clipboard.writeText).mock
      .calls[0]![0];
    expect(copied).toContain("Iced Coffee");
    expect(copied).toContain(MERCHANT);
  });

  it("downloads the payload as a file", () => {
    render(<QrFerry />);
    fireEvent.click(screen.getByRole("button", { name: /Generate envelope/i }));

    fireEvent.click(screen.getByRole("button", { name: /Download payload/i }));
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Import panel — valid import and review
// ---------------------------------------------------------------------------

describe("QrFerry — import panel valid import", () => {
  it("pastes a valid payload, imports, and shows the review", () => {
    const onValidated = vi.fn();
    render(<QrFerry onValidatedEnvelope={onValidated} />);

    const json = craftJson("nonce-valid-001");
    const textarea = screen.getByPlaceholderText(/Paste envelope payload/i);
    fireEvent.change(textarea, { target: { value: json } });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveTextContent(/Iced Coffee/i);
    expect(review).toHaveTextContent(/2/); // quantity
    expect(review).toHaveTextContent(/6.*SUI/i); // total
    expect(review).toHaveTextContent(MERCHANT);
    expect(review).toHaveTextContent(/expir/i);
    // No error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onValidatedEnvelope with the validated envelope", () => {
    const onValidated = vi.fn();
    render(<QrFerry onValidatedEnvelope={onValidated} />);

    const json = craftJson("nonce-valid-002");
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    expect(onValidated).toHaveBeenCalledTimes(1);
    const env = onValidated.mock.calls[0]![0] as QrFerryEnvelope;
    expect(env.item).toBe("Iced Coffee");
    expect(env.quantity).toBe(2);
    expect(env.nonce).toBe("nonce-valid-002");
  });

  it("shows a handoff-to-checkout state after successful import", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-valid-003");
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    expect(screen.getByText(/ready to hand off into payment action/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to checkout/i })).toBeInTheDocument();
  });

  it("announces successful import via a polite status role for screen readers", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-status-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    // The validated-envelope region uses role="status" (polite live region)
    // so screen readers announce the successful import without interrupting
    // the user. It must not use the assertive alert role reserved for errors.
    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveAttribute("role", "status");
    expect(review).not.toHaveAttribute("role", "alert");
  });

  it("reviews the payer address when present in the envelope", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-payer-001", { payerAddress: PAYER });
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveTextContent(PAYER);
  });
});

// ---------------------------------------------------------------------------
// Import panel — replay rejection
// ---------------------------------------------------------------------------

describe("QrFerry — replay rejection", () => {
  it("rejects the same payload imported twice with an already-used error", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-replay-001");

    // First import succeeds.
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();

    // Second import of the same payload is rejected.
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/already.*used|replay|duplicate/i);
    // The previous validated state is cleared.
    expect(screen.queryByTestId("validated-envelope")).not.toBeInTheDocument();
  });

  it("persists consumed nonces across remount (localStorage survives refresh)", () => {
    const json = craftJson("nonce-refresh-001");

    // First mount: import succeeds, nonce consumed.
    const { unmount } = render(<QrFerry />);
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    unmount();

    // Second mount (simulating refresh): same payload must still be rejected.
    render(<QrFerry />);
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/already.*used|replay|duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// Import panel — expired and tamper rejection
// ---------------------------------------------------------------------------

describe("QrFerry — expired and tamper rejection", () => {
  it("rejects an expired fixture with an expired error", () => {
    render(<QrFerry />);
    // Envelope whose expiresAt is in the past relative to NOW.
    const json = craftJson("nonce-expired-001", {
      createdAt: NOW - 120_000,
      expiresAt: NOW - 60_000,
    });
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/expired/i);
  });

  it("rejects a tampered payload (modified field) with a checksum error", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-tamper-001");
    const tampered = JSON.parse(json);
    tampered.quantity = 99; // change a covered field without updating checksum
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: JSON.stringify(tampered) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/checksum|tamper/i);
  });

  it("rejects malformed JSON with an error", () => {
    render(<QrFerry />);
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: "{not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

describe("QrFerry — file import", () => {
  it("renders a file input for importing payload from a file", () => {
    render(<QrFerry />);
    const input = screen.getByLabelText(/Import from file/i);
    expect(input).toHaveAttribute("type", "file");
    expect(input.getAttribute("accept")).toMatch(/json|txt/);
  });

  it("reads a file and populates the paste textarea", async () => {
    // file.text() resolves via the event loop; use real timers so waitFor
    // can poll. beforeEach restores fake timers for the next test.
    vi.useRealTimers();
    vi.setSystemTime(NOW);

    render(<QrFerry />);
    const json = craftJson("nonce-file-001");
    const file = new File([json], "envelope.json", { type: "application/json" });
    const input = screen.getByLabelText(/Import from file/i) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Paste envelope payload/i)).toHaveValue(
        json,
      );
    });
  });

  it("re-selecting the identical file twice still fires and repopulates", async () => {
    // Regression: the input value must be reset after each pick so that
    // choosing the same file again still fires onChange in a real browser
    // (which suppresses change when the value is unchanged). jsdom's
    // fireEvent.change dispatches unconditionally, so we additionally
    // assert input.value === "" after each pick — that is the mechanism
    // that enables re-selection in real browsers.
    vi.useRealTimers();
    vi.setSystemTime(NOW);

    render(<QrFerry />);
    const json = craftJson("nonce-file-repeat-001");
    const file = new File([json], "envelope.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText(/Import from file/i) as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(/Paste envelope payload/i);

    // First pick populates the textarea and resets the input value.
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(textarea).toHaveValue(json));
    expect(input.value).toBe("");

    // Simulate the user clearing the textarea before re-picking.
    fireEvent.change(textarea, { target: { value: "" } });
    expect(textarea).toHaveValue("");

    // Second pick of the SAME file reference must still fire and repopulate,
    // and again leave the input value cleared for a third pick.
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(textarea).toHaveValue(json));
    expect(input.value).toBe("");
  });

  it("re-selecting the identical file after a parse failure repopulates", async () => {
    // Regression for the post-failure path: a prior parse failure must not
    // leave the input value set, which would suppress re-picking a corrected
    // file with the same name/type in a real browser.
    vi.useRealTimers();
    vi.setSystemTime(NOW);

    render(<QrFerry />);
    const badJson = "{not valid json";
    const goodJson = craftJson("nonce-file-recover-001");
    const badFile = new File([badJson], "envelope.json", {
      type: "application/json",
    });
    const goodFile = new File([goodJson], "envelope.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText(/Import from file/i) as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(/Paste envelope payload/i);

    // Pick a malformed file, then attempt import (fails).
    fireEvent.change(input, { target: { files: [badFile] } });
    await waitFor(() => expect(textarea).toHaveValue(badJson));
    // Input must be cleared even though the file was read successfully —
    // the parse failure happens later in handleImport, not handleFile.
    expect(input.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Re-pick a corrected file with the SAME name/type and import succeeds.
    fireEvent.change(input, { target: { files: [goodFile] } });
    await waitFor(() => expect(textarea).toHaveValue(goodJson));
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Corrupt replay storage — fail-closed degraded state
// ---------------------------------------------------------------------------

describe("QrFerry — corrupt replay storage fail-closed", () => {
  it("shows a role=alert warning and blocks imports when localStorage has malformed JSON", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "{not valid json");
    render(<QrFerry />);

    const warning = screen.getByRole("alert");
    expect(warning).toHaveAttribute("data-testid", "replay-degraded-warning");
    expect(warning).toHaveTextContent(/replay.*unavailable|unavailable/i);
    expect(warning).toHaveTextContent(/reset|recovery|deliberately/i);

    // Import is blocked: the button is disabled.
    const importBtn = screen.getByRole("button", {
      name: /Import and validate/i,
    });
    expect(importBtn).toBeDisabled();
  });

  it("shows the degraded warning when localStorage has wrong-shaped JSON (object, not a string array)", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    render(<QrFerry />);

    const warning = screen.getByTestId("replay-degraded-warning");
    expect(warning).toHaveTextContent(/replay.*unavailable|unavailable/i);
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).toBeDisabled();
  });

  it("shows the degraded warning when localStorage is a JSON number", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "42");
    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).toBeDisabled();
  });

  it("shows the degraded warning when localStorage is a mixed-type array", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(["ok", 123]));
    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
  });

  it("does not accept any nonce while degraded — no validated envelope appears", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "not-json-at-all");
    render(<QrFerry />);

    const json = craftJson("nonce-degraded-001");
    const textarea = screen.getByPlaceholderText(/Paste envelope payload/i);
    fireEvent.change(textarea, { target: { value: json } });

    // The import button is disabled; clicking is a no-op even if forced.
    const importBtn = screen.getByRole("button", {
      name: /Import and validate/i,
    });
    expect(importBtn).toBeDisabled();
    fireEvent.click(importBtn);

    expect(screen.queryByTestId("validated-envelope")).not.toBeInTheDocument();
    // The degraded warning is still the only alert.
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
  });

  it("does NOT show a degraded warning when storage is a valid string array", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(["prior-nonce"]));
    render(<QrFerry />);
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();
    // Not degraded -> import is enabled once payload is present (the only
    // other disable reason is an empty payload).
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: craftJson("nonce-healthy-001") },
    });
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).not.toBeDisabled();
  });

  it("does NOT show a degraded warning when storage is an empty array", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "[]");
    render(<QrFerry />);
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();
  });

  it("recovery clears only the QR nonce key and restores protection without touching other storage", () => {
    // Seed unrelated storage that MUST be preserved across recovery.
    localStorage.setItem("unrelated-key", "keep-me");
    localStorage.setItem("cv-other-thing", "also-keep");
    // Seed corrupt replay storage.
    localStorage.setItem(NONCE_STORAGE_KEY, "corrupt-garbage{{{");

    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).toBeDisabled();

    // Trigger explicit recovery.
    fireEvent.click(
      screen.getByRole("button", { name: /Reset replay storage/i }),
    );

    // Warning is gone.
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();

    // ONLY the QR nonce key was cleared; other storage untouched.
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
    expect(localStorage.getItem("cv-other-thing")).toBe("also-keep");
    expect(localStorage.getItem(NONCE_STORAGE_KEY)).toBeNull();

    // Protection is reconstructed: a fresh import now succeeds.
    const json = craftJson("nonce-recover-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: json },
    });
    // Import is re-enabled now that payload is present and not degraded.
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Import and validate/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // And the consumed nonce was persisted to the reconstructed registry.
    expect(localStorage.getItem(NONCE_STORAGE_KEY)).toBe(
      JSON.stringify(["nonce-recover-001"]),
    );
    // Other storage still untouched after a successful post-recovery import.
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("recovery from a wrong-shaped blob also restores protection", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify({ nope: true }));
    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Reset replay storage/i }),
    );
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();
    // Import is re-enabled once payload is present (no longer degraded).
    fireEvent.change(screen.getByPlaceholderText(/Paste envelope payload/i), {
      target: { value: craftJson("nonce-recover-shape-001") },
    });
    expect(
      screen.getByRole("button", { name: /Import and validate/i }),
    ).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Hit targets and monochrome
// ---------------------------------------------------------------------------

describe("QrFerry — hit targets and monochrome", () => {
  it("all buttons have a minimum 44px hit target", () => {
    render(<QrFerry />);
    fireEvent.click(screen.getByRole("button", { name: /Generate envelope/i }));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const btn of buttons) {
      expect(btn.className).toMatch(/min-h-11/);
    }
  });

  it("uses no gradient classes", () => {
    const { container } = render(<QrFerry />);
    fireEvent.click(screen.getByRole("button", { name: /Generate envelope/i }));
    const elements = container.querySelectorAll("[class]");
    for (const el of elements) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/gradient|bg-gradient|from-|via-|to-/);
    }
  });
});
