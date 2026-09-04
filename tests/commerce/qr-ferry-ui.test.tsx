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
  it("renders the QR workspace heading and scan section", () => {
    render(<QrFerry />);
    expect(
      screen.getByRole("heading", { name: /Scan, pay, or collect/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Scan and pay/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/QR carries the exact request/i),
    ).toHaveTextContent(/approve its Sui agreement.*public receipt/i);
  });

  it("shows a dominant Scan QR card as the first-frame primary action", () => {
    render(<QrFerry />);
    // The scan card is the dominant first frame; Scan QR is the primary
    // action and is rendered before any creator or manual control.
    const scanCard = screen.getByTestId("scan-card");
    expect(scanCard).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    // No raw JSON textarea or file picker is visible by default.
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Open from file/i)).not.toBeInTheDocument();
    // The River Cafe creator is not in the first frame.
    expect(screen.queryByTestId("generate-panel")).not.toBeInTheDocument();
  });

  it("keeps the manual paste/file fallback collapsed behind Enter manually by default", () => {
    render(<QrFerry />);
    const manualTrigger = screen.getByTestId("manual-entry-disclosure");
    expect(manualTrigger).toHaveTextContent(/Enter manually/i);
    expect(manualTrigger).toHaveAttribute("aria-expanded", "false");
    // Collapsed -> no textarea or file input rendered.
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Open from file/i)).not.toBeInTheDocument();
  });

  it("keeps the River Cafe shop-payment creator collapsed behind Create a shop payment by default", () => {
    render(<QrFerry />);
    const createTrigger = screen.getByTestId("create-shop-payment-disclosure");
    expect(createTrigger).toHaveTextContent(/Create a shop payment/i);
    expect(createTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("generate-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create payment QR/i })).not.toBeInTheDocument();
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
      screen.getByRole("heading", { name: /Scan, pay, or collect/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Generate panel
// ---------------------------------------------------------------------------

describe("QrFerry — generate panel", () => {
  it("shows the safe demo purchase details after opening Create a shop payment", () => {
    render(<QrFerry />);
    // The creator is collapsed by default; open it.
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    const generatePanel = screen.getByTestId("generate-panel");
    expect(generatePanel).toHaveTextContent(/Iced Coffee/i);
    expect(generatePanel).toHaveTextContent(/River Cafe/i);
    expect(generatePanel).toHaveTextContent(/2/); // quantity
    expect(generatePanel).toHaveTextContent(/6.*SUI/i); // total
  });

  it("renders a QR code and payload after clicking Generate", () => {
    render(<QrFerry />);
    // Open the collapsed creator, then generate.
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    // No QR before generate (scope to the creator panel so the disclosure
    // chevron icons are not counted as QR codes).
    const panel = screen.getByTestId("generate-panel");
    expect(panel.querySelector("svg")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Create payment QR/i }));

    // QR SVG appears inside the creator panel.
    expect(panel.querySelector("svg")).not.toBeNull();
    // Payload text is visible and contains the item and merchant.
    const payload = screen.getByTestId("envelope-payload");
    expect(payload).toHaveTextContent(/Iced Coffee/);
    expect(payload).toHaveTextContent(MERCHANT);
  });

  it("copies the payload to the clipboard", () => {
    render(<QrFerry />);
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    fireEvent.click(screen.getByRole("button", { name: /Create payment QR/i }));

    const copyBtn = screen.getByRole("button", { name: /Copy code/i });
    fireEvent.click(copyBtn);

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = vi.mocked(globalThis.navigator.clipboard.writeText).mock
      .calls[0]![0];
    expect(copied).toContain("Iced Coffee");
    expect(copied).toContain(MERCHANT);
  });

  it("downloads the payload as a file", () => {
    render(<QrFerry />);
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    fireEvent.click(screen.getByRole("button", { name: /Create payment QR/i }));

    fireEvent.click(screen.getByRole("button", { name: /Download code/i }));
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Import panel — valid import and review
// ---------------------------------------------------------------------------

describe("QrFerry — import panel valid import", () => {
  // The manual paste/file fallback is collapsed behind "Enter manually" by
  // default; open it before each import-path test.
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("pastes a valid payload, imports, and shows the review", () => {
    const onValidated = vi.fn();
    render(<QrFerry onValidatedEnvelope={onValidated} />);
    openManual();

    const json = craftJson("nonce-valid-001");
    const textarea = screen.getByPlaceholderText(/Paste payment code/i);
    fireEvent.change(textarea, { target: { value: json } });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveTextContent(/Iced Coffee/i);
    expect(review).toHaveTextContent(/2/); // quantity
    expect(review).toHaveTextContent(/6.*SUI/i); // total
    // The full merchant address is kept in a title attribute (truncated
    // visibly to avoid overflow); assert the full value is accessible.
    const merchantDd = Array.from(
      review.querySelectorAll("dd[title]"),
    ).find((dd) => dd.getAttribute("title") === MERCHANT);
    expect(merchantDd).toBeTruthy();
    expect(review).toHaveTextContent(/expir/i);
    // No error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onValidatedEnvelope with the validated envelope", () => {
    const onValidated = vi.fn();
    render(<QrFerry onValidatedEnvelope={onValidated} />);
    openManual();

    const json = craftJson("nonce-valid-002");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    expect(onValidated).toHaveBeenCalledTimes(1);
    const env = onValidated.mock.calls[0]![0] as QrFerryEnvelope;
    expect(env.item).toBe("Iced Coffee");
    expect(env.quantity).toBe(2);
    expect(env.nonce).toBe("nonce-valid-002");
  });

  it("shows a handoff-to-checkout state after successful import", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-valid-003");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    expect(screen.getByText(/ready to hand off into the same guarded checkout/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to checkout/i })).toBeInTheDocument();
  });

  it("hides the scanner, manual controls, and creator after successful import (carried payment is the whole page)", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-valid-import-hides-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    // The carried payment is the whole page: scanner, manual controls, and
    // the creator are all hidden.
    expect(screen.queryByTestId("scan-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scan-qr-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("manual-entry-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-shop-payment-disclosure")).not.toBeInTheDocument();
    // No raw handoff JSON remains visible; the textarea was cleared and is
    // unmounted with the manual disclosure.
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
    // A quiet Scan another reset is present.
    expect(screen.getByTestId("scan-another")).toBeInTheDocument();
  });

  it("Scan another clears only imported state and returns to the empty scanner state", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-valid-scan-another-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("scan-another"));

    // Back to the empty scan-first frame.
    expect(screen.queryByTestId("validated-envelope")).not.toBeInTheDocument();
    expect(screen.getByTestId("scan-card")).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    // The manual disclosure is collapsed again and the textarea is cleared.
    expect(screen.queryByPlaceholderText(/Paste payment code/i)).not.toBeInTheDocument();
  });

  it("announces successful import via a polite status role for screen readers", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-status-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    // The validated-envelope region uses role="status" (polite live region)
    // so screen readers announce the successful import without interrupting
    // the user. It must not use the assertive alert role reserved for errors.
    const review = screen.getByTestId("validated-envelope");
    expect(review).toHaveAttribute("role", "status");
    expect(review).not.toHaveAttribute("role", "alert");
  });

  it("reviews the payer address when present in the envelope", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-payer-001", { payerAddress: PAYER });
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    const review = screen.getByTestId("validated-envelope");
    // The full payer address is kept in the title attribute for assistive
    // tech and copy, while the visible text is truncated to avoid overflow.
    expect(review).toHaveTextContent(/payer address/i);
    const titledDds = review.querySelectorAll("dd[title]");
    const payerNode = Array.from(titledDds).find(
      (dd) => dd.getAttribute("title") === PAYER,
    );
    expect(payerNode).toBeTruthy();
    expect(payerNode?.getAttribute("title")).toBe(PAYER);
  });
});

// ---------------------------------------------------------------------------
// Import panel — replay rejection
// ---------------------------------------------------------------------------

describe("QrFerry — replay rejection", () => {
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("rejects the same payload imported twice with an already-used error", () => {
    render(<QrFerry />);
    const json = craftJson("nonce-replay-001");

    // First import succeeds.
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();

    // Return to the empty scanner, then re-import the same payload — the
    // consumed nonce must still be rejected (replay protection persists).
    fireEvent.click(screen.getByTestId("scan-another"));
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/already.*used|replay|duplicate/i);
    // The previous validated state is cleared.
    expect(screen.queryByTestId("validated-envelope")).not.toBeInTheDocument();
  });

  it("persists consumed nonces across remount (localStorage survives refresh)", () => {
    const json = craftJson("nonce-refresh-001");

    // First mount: import succeeds, nonce consumed.
    const { unmount } = render(<QrFerry />);
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    unmount();

    // Second mount (simulating refresh): same payload must still be rejected.
    render(<QrFerry />);
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/already.*used|replay|duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// Import panel — expired and tamper rejection
// ---------------------------------------------------------------------------

describe("QrFerry — expired and tamper rejection", () => {
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("rejects an expired fixture with an expired error", () => {
    render(<QrFerry />);
    openManual();
    // Envelope whose expiresAt is in the past relative to NOW.
    const json = craftJson("nonce-expired-001", {
      createdAt: NOW - 120_000,
      expiresAt: NOW - 60_000,
    });
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/expired/i);
  });

  it("rejects a tampered payload (modified field) with a checksum error", () => {
    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-tamper-001");
    const tampered = JSON.parse(json);
    tampered.quantity = 99; // change a covered field without updating checksum
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: JSON.stringify(tampered) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/checksum|tamper/i);
  });

  it("rejects malformed JSON with an error and keeps the scanner/manual fallback visible", () => {
    render(<QrFerry />);
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: "{not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));

    // One concise error; the scanner and manual fallback stay visible.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("scan-card")).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste payment code/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

describe("QrFerry — file import", () => {
  // The file input lives behind the collapsed "Enter manually" disclosure.
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("renders a file input for importing payload from a file", () => {
    render(<QrFerry />);
    openManual();
    const input = screen.getByLabelText(/Open from file/i);
    expect(input).toHaveAttribute("type", "file");
    expect(input.getAttribute("accept")).toMatch(/json|txt/);
  });

  it("reads a file and populates the paste textarea", async () => {
    // file.text() resolves via the event loop; use real timers so waitFor
    // can poll. beforeEach restores fake timers for the next test.
    vi.useRealTimers();
    vi.setSystemTime(NOW);

    render(<QrFerry />);
    openManual();
    const json = craftJson("nonce-file-001");
    const file = new File([json], "envelope.json", { type: "application/json" });
    const input = screen.getByLabelText(/Open from file/i) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Paste payment code/i)).toHaveValue(
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
    openManual();
    const json = craftJson("nonce-file-repeat-001");
    const file = new File([json], "envelope.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText(/Open from file/i) as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(/Paste payment code/i);

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
    openManual();
    const badJson = "{not valid json";
    const goodJson = craftJson("nonce-file-recover-001");
    const badFile = new File([badJson], "envelope.json", {
      type: "application/json",
    });
    const goodFile = new File([goodJson], "envelope.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText(/Open from file/i) as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(/Paste payment code/i);

    // Pick a malformed file, then attempt import (fails).
    fireEvent.change(input, { target: { files: [badFile] } });
    await waitFor(() => expect(textarea).toHaveValue(badJson));
    // Input must be cleared even though the file was read successfully —
    // the parse failure happens later in handleImport, not handleFile.
    expect(input.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Re-pick a corrected file with the SAME name/type and import succeeds.
    fireEvent.change(input, { target: { files: [goodFile] } });
    await waitFor(() => expect(textarea).toHaveValue(goodJson));
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
    expect(screen.getByTestId("validated-envelope")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Corrupt replay storage — fail-closed degraded state
// ---------------------------------------------------------------------------

describe("QrFerry — corrupt replay storage fail-closed", () => {
  // The manual paste/file fallback is collapsed by default; open it when a
  // test needs to drive the manual import path.
  function openManual() {
    fireEvent.click(screen.getByTestId("manual-entry-disclosure"));
  }

  it("shows a role=alert warning and blocks imports when localStorage has malformed JSON", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "{not valid json");
    render(<QrFerry />);

    const warning = screen.getByRole("alert");
    expect(warning).toHaveAttribute("data-testid", "replay-degraded-warning");
    expect(warning).toHaveTextContent(/replay.*unavailable|unavailable/i);
    expect(warning).toHaveTextContent(/reset|recovery|deliberately/i);

    // Import is blocked: the dominant Scan QR primary action is disabled.
    expect(screen.getByTestId("scan-qr-button")).toBeDisabled();
  });

  it("shows the degraded warning when localStorage has wrong-shaped JSON (object, not a string array)", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    render(<QrFerry />);

    const warning = screen.getByTestId("replay-degraded-warning");
    expect(warning).toHaveTextContent(/replay.*unavailable|unavailable/i);
    expect(screen.getByTestId("scan-qr-button")).toBeDisabled();
  });

  it("shows the degraded warning when localStorage is a JSON number", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "42");
    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
    expect(screen.getByTestId("scan-qr-button")).toBeDisabled();
  });

  it("shows the degraded warning when localStorage is a mixed-type array", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(["ok", 123]));
    render(<QrFerry />);
    expect(screen.getByTestId("replay-degraded-warning")).toBeInTheDocument();
  });

  it("does not accept any nonce while degraded — no validated envelope appears", () => {
    localStorage.setItem(NONCE_STORAGE_KEY, "not-json-at-all");
    render(<QrFerry />);
    openManual();

    const json = craftJson("nonce-degraded-001");
    const textarea = screen.getByPlaceholderText(/Paste payment code/i);
    fireEvent.change(textarea, { target: { value: json } });

    // The manual Open payment button is disabled while degraded; clicking
    // is a no-op even if forced.
    const importBtn = screen.getByRole("button", {
      name: /Open payment/i,
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
    // Not degraded -> Scan QR is enabled.
    expect(screen.getByTestId("scan-qr-button")).not.toBeDisabled();
    // And the manual Open payment is enabled once payload is present (the
    // only other disable reason is an empty payload).
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: craftJson("nonce-healthy-001") },
    });
    expect(
      screen.getByRole("button", { name: /Open payment/i }),
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
    expect(screen.getByTestId("scan-qr-button")).toBeDisabled();

    // Trigger explicit recovery.
    fireEvent.click(
      screen.getByRole("button", { name: /Reset protection/i }),
    );

    // Warning is gone.
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();

    // ONLY the QR nonce key was cleared; other storage untouched.
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
    expect(localStorage.getItem("cv-other-thing")).toBe("also-keep");
    expect(localStorage.getItem(NONCE_STORAGE_KEY)).toBeNull();

    // Protection is reconstructed: a fresh import now succeeds.
    openManual();
    const json = craftJson("nonce-recover-001");
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: json },
    });
    // Import is re-enabled now that payload is present and not degraded.
    expect(
      screen.getByRole("button", { name: /Open payment/i }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Open payment/i }));
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
      screen.getByRole("button", { name: /Reset protection/i }),
    );
    expect(screen.queryByTestId("replay-degraded-warning")).not.toBeInTheDocument();
    // Import is re-enabled once payload is present (no longer degraded).
    openManual();
    fireEvent.change(screen.getByPlaceholderText(/Paste payment code/i), {
      target: { value: craftJson("nonce-recover-shape-001") },
    });
    expect(
      screen.getByRole("button", { name: /Open payment/i }),
    ).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Hit targets and monochrome
// ---------------------------------------------------------------------------

describe("QrFerry — hit targets and monochrome", () => {
  it("all buttons have a minimum 44px hit target", () => {
    render(<QrFerry />);
    // Open the collapsed creator so its buttons are part of the set.
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    fireEvent.click(screen.getByRole("button", { name: /Create payment QR/i }));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const btn of buttons) {
      expect(btn.className).toMatch(/min-h-11|min-h-\[44px\]/);
    }
  });

  it("uses no gradient classes", () => {
    const { container } = render(<QrFerry />);
    fireEvent.click(screen.getByTestId("create-shop-payment-disclosure"));
    fireEvent.click(screen.getByRole("button", { name: /Create payment QR/i }));
    const elements = container.querySelectorAll("[class]");
    for (const el of elements) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/gradient|bg-gradient|from-|via-|to-/);
    }
  });
});
