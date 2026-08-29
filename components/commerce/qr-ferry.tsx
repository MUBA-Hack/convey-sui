"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PurchaseIntentPreview } from "@/lib/commerce/intent";
import {
  createEnvelope,
  exportEnvelopeJson,
  importEnvelope,
  QrFerryError,
  type QrFerryEnvelope,
  type ReplayRegistry,
} from "@/lib/commerce/qr-ferry";
import { PaymentAction } from "./payment-action";

/**
 * Offline QR Ferry UI (Wave 3, Task 3.2 UI).
 *
 * Two panels:
 *  - Offline device: creates a tamper-evident envelope from a safe demo
 *    purchase and renders a QR code plus copy/download payload.
 *  - Connected device: pastes/imports the payload, validates it, reviews
 *    item/qty/SUI/address/expiry, consumes the nonce once via a
 *    localStorage-backed ReplayRegistry, and exposes the validated envelope
 *    to a future payment action integration (no transaction code here).
 *
 * This is a TRANSPORT envelope, not cryptographic payer authorization. The
 * checksum detects tampering; the nonce registry defends against replay.
 * No signature or authorization is implied.
 */

// --- Demo purchase (simulation) -------------------------------------------

/** 1 SUI = 1e9 MIST. */
const MIST_PER_SUI = 1_000_000_000n;

/**
 * Deterministic demo merchant address. The catalog carries `address: null`
 * in simulation mode; the QR Ferry envelope requires a valid Sui address, so
 * we use this explicitly-labelled simulation address. This is NOT a claim of
 * a real testnet deployment.
 */
const DEMO_MERCHANT_ADDRESS = "0x".concat("11".repeat(32)) as `0x${string}`;

const DEMO_ITEM = "Iced Coffee";
const DEMO_QUANTITY = 2;
const DEMO_UNIT_PRICE_MIST = 3n * MIST_PER_SUI; // 3 SUI
const DEMO_TOTAL_MIST = BigInt(DEMO_QUANTITY) * DEMO_UNIT_PRICE_MIST; // 6 SUI
const DEMO_MERCHANT_NAME = "River Cafe";

/** Envelope lifetime (1 hour, well under the 24h cap). */
const EXPIRY_WINDOW_MS = 60 * 60 * 1000;

// --- localStorage-backed ReplayRegistry -----------------------------------

/**
 * localStorage key under which consumed nonces are persisted. Exported so
 * tests can seed/clear the exact key without hardcoding it.
 */
export const NONCE_STORAGE_KEY = "cv-qr-ferry-consumed-nonces";

/**
 * Why replay protection is unavailable. Surfaced to the UI so the warning
 * can distinguish "the stored blob was not valid JSON" from "the stored blob
 * parsed but was not a string array" — both are fail-closed conditions.
 */
export type ReplayDegradedReason = "corrupt_json" | "wrong_shape";

/**
 * `unknown` -> `string[]` narrowing. The previous implementation trusted a
 * `JSON.parse(raw) as string[]` cast, which let non-array values (numbers,
 * objects, arrays of non-strings) silently become an empty/oddly-shaped Set
 * — a fail-OPEN condition. This guard is the boundary check that closes it.
 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * ReplayRegistry backed by localStorage so consumed nonces survive page
 * refresh. Demo scope only — production requires an on-chain nonce registry
 * or trusted sponsor index.
 *
 * SECURITY: if the persisted blob is missing, corrupt, or wrong-shaped, the
 * registry enters a DEGRADED, FAIL-CLOSED state. While degraded,
 * `tryConsume` rejects every nonce (returns false) so no envelope can be
 * imported — replay validation is unavailable rather than silently bypassed.
 * The UI must surface a `role=alert` warning and offer an explicit recovery
 * action (`recover`) that clears ONLY this key and reconstructs protection.
 * The registry never auto-accepts a nonce to "recover" itself.
 */
class LocalStorageReplayRegistry implements ReplayRegistry {
  private seen: Set<string>;
  private degradedReason: ReplayDegradedReason | null;

  constructor() {
    const { seen, degradedReason } = LocalStorageReplayRegistry.assess();
    this.seen = seen;
    this.degradedReason = degradedReason;
  }

  /**
   * Single source of truth for reading persisted replay state. Returns the
   * reconstructed `seen` set and the fail-closed degraded reason (null when
   * healthy). Also used by the static `isStorageDegraded` probe so the UI can
   * initialize its degraded flag without touching a ref during render.
   */
  private static assess(): {
    seen: Set<string>;
    degradedReason: ReplayDegradedReason | null;
  } {
    let raw: string | null;
    try {
      raw = localStorage.getItem(NONCE_STORAGE_KEY);
    } catch {
      // localStorage itself unavailable (disabled, private mode quota). We
      // cannot know prior consumed nonces, so fail closed rather than start
      // empty and accept replays.
      return { seen: new Set(), degradedReason: "corrupt_json" };
    }
    if (raw === null) {
      // No prior state — fresh install. Not degraded.
      return { seen: new Set(), degradedReason: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON blob. Fail closed; do not silently reset.
      return { seen: new Set(), degradedReason: "corrupt_json" };
    }
    if (!isStringArray(parsed)) {
      // Parsed but not a string[] (e.g. an object, number, or mixed array).
      // Fail closed; do not silently reset.
      return { seen: new Set(), degradedReason: "wrong_shape" };
    }
    return { seen: new Set(parsed), degradedReason: null };
  }

  /**
   * UI-side probe: true when persisted replay storage is corrupt or
   * wrong-shaped and imports must be blocked. Safe to call during render
   * (it does not touch any React ref).
   */
  static isStorageDegraded(): boolean {
    return LocalStorageReplayRegistry.assess().degradedReason !== null;
  }

  /** True when replay protection is unavailable and imports must be blocked. */
  isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  /** The specific fail-closed reason, or null when protection is healthy. */
  degradedState(): ReplayDegradedReason | null {
    return this.degradedReason;
  }

  tryConsume(nonce: string): boolean {
    if (this.degradedReason !== null) {
      // Fail closed: never accept a nonce while replay protection is
      // unavailable. The UI must surface the degraded warning and offer
      // explicit recovery before any import can succeed.
      return false;
    }
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    try {
      localStorage.setItem(
        NONCE_STORAGE_KEY,
        JSON.stringify([...this.seen]),
      );
    } catch {
      // Storage full or unavailable — the in-memory set still defends this
      // session. We do not silently drop the consume decision.
    }
    return true;
  }

  /**
   * Explicit recovery: clears ONLY the QR nonce key from localStorage and
   * reconstructs a fresh, non-degraded empty registry in place. Other
   * localStorage entries are untouched. After this, replay protection is
   * healthy (empty) and imports can proceed.
   */
  recover(): void {
    try {
      localStorage.removeItem(NONCE_STORAGE_KEY);
    } catch {
      // Best effort; the in-memory state is still reset below.
    }
    this.seen = new Set();
    this.degradedReason = null;
  }
}

// --- Helpers ---------------------------------------------------------------

/** Generate a unique nonce, preferring crypto.randomUUID when available. */
function generateNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Format a MIST string as a human-readable SUI amount (trailing zeros trimmed). */
function mistToSui(mist: string): string {
  const big = BigInt(mist);
  const sui = big / MIST_PER_SUI;
  const fraction = big % MIST_PER_SUI;
  if (fraction === 0n) return sui.toString();
  return `${sui}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

/** Format epoch ms as a locale string. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Friendly error messages keyed by QrFerryError reason. */
const FRIENDLY_ERRORS: Record<string, string> = {
  duplicate_nonce:
    "Already used — this envelope's nonce was already consumed (replay rejected).",
  expired: "Expired — this envelope has passed its expiry time.",
  checksum_mismatch:
    "Checksum mismatch — the payload may have been tampered with.",
  malformed_json: "Malformed JSON — the payload is not valid JSON.",
  unsupported_version:
    "Unsupported version — this envelope uses an unknown wire version.",
  invalid_shape: "Invalid shape — the payload is not a well-formed envelope.",
  invalid_merchant: "Invalid merchant address.",
  invalid_payer: "Invalid payer address.",
  invalid_amount: "Invalid amount.",
  invalid_quantity: "Invalid quantity.",
  invalid_item: "Invalid item.",
  invalid_nonce: "Invalid nonce.",
  invalid_timestamps: "Invalid timestamps.",
  future:
    "Future-dated — this envelope's creation time is too far ahead of now.",
};

function errorMessage(err: unknown): string {
  if (err instanceof QrFerryError) {
    return FRIENDLY_ERRORS[err.reason] ?? err.message;
  }
  return err instanceof Error ? err.message : "Import failed.";
}

// --- Component -------------------------------------------------------------

export interface QrFerryProps {
  /**
   * Called with the validated envelope after a successful import. This is the
   * seam for a future payment-action integration — no transaction code is
   * wired here.
   */
  onValidatedEnvelope?: (env: QrFerryEnvelope) => void;
}

export function QrFerry({ onValidatedEnvelope }: QrFerryProps = {}) {
  const [envelope, setEnvelope] = useState<QrFerryEnvelope | null>(null);
  const [payload, setPayload] = useState("");
  const [imported, setImported] = useState<QrFerryEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPreview, setCheckoutPreview] = useState<PurchaseIntentPreview | null>(null);

  const registryRef = useRef<LocalStorageReplayRegistry | null>(null);
  if (registryRef.current === null) {
    registryRef.current = new LocalStorageReplayRegistry();
  }
  // Fail-closed degraded state: when replay storage is corrupt/wrong-shaped,
  // imports are blocked and a role=alert warning is shown until the user
  // explicitly resets the QR nonce key. Initialized via the static probe so
  // no React ref is read during render.
  const [replayDegraded, setReplayDegraded] = useState(() =>
    LocalStorageReplayRegistry.isStorageDegraded(),
  );

  const handleGenerate = () => {
    const now = Date.now();
    const env = createEnvelope({
      item: DEMO_ITEM,
      quantity: DEMO_QUANTITY,
      totalMist: DEMO_TOTAL_MIST,
      merchantAddress: DEMO_MERCHANT_ADDRESS,
      nonce: generateNonce(),
      createdAt: now,
      expiresAt: now + EXPIRY_WINDOW_MS,
    });
    setEnvelope(env);
  };

  const handleCopy = async () => {
    if (!envelope) return;
    const json = exportEnvelopeJson(envelope);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Clipboard may be unavailable; the payload is still visible for manual copy.
    }
  };

  const handleDownload = () => {
    if (!envelope) return;
    const json = exportEnvelopeJson(envelope);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qr-ferry-envelope.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so re-selecting the identical file (including
    // after a prior parse failure) still fires onChange and repopulates the
    // textarea. The File reference is already held locally, so clearing the
    // input's value does not invalidate it.
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    setPayload(text);
  };

  const handleImport = () => {
    // Defense in depth: the import button is disabled while degraded, but
    // even if an import is attempted, refuse to consult a degraded registry.
    // The registry itself also fails closed (tryConsume returns false).
    if (replayDegraded) return;
    try {
      const env = importEnvelope(payload, {
        registry: registryRef.current ?? undefined,
      });
      setImported(env);
      setCheckoutPreview(null);
      setError(null);
      onValidatedEnvelope?.(env);
    } catch (err) {
      setImported(null);
      setError(errorMessage(err));
    }
  };

  const handoffToCheckout = () => {
    if (!imported) return;
    const quantity = imported.quantity;
    const totalMist = BigInt(imported.totalMist);
    setCheckoutPreview({
      kind: "preview",
      action: "buy",
      item: { id: "qr-ferry-imported", name: imported.item },
      quantity,
      unitPriceMist: (totalMist / BigInt(quantity)).toString(),
      totalMist: imported.totalMist,
      priceCeilingMist: null,
      merchant: {
        id: imported.merchantAddress,
        name: DEMO_MERCHANT_NAME,
        address: imported.merchantAddress,
      },
      confidence: 1,
      clarification: null,
    });
  };

  /**
   * Explicit recovery for the fail-closed degraded state. Clears ONLY the
   * QR nonce key from localStorage and reconstructs a fresh, healthy
   * (empty) registry. Other localStorage entries are untouched.
   */
  const handleRecoverReplayStorage = () => {
    registryRef.current?.recover();
    setReplayDegraded(false);
    setError(null);
    setImported(null);
  };

  const envelopeJson = envelope ? exportEnvelopeJson(envelope) : "";

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
      <header className="flex flex-col gap-2">
        <p className="cv-micro cv-micro-sm text-neutral-500">
          Offline transport
        </p>
        <h1 className="text-2xl font-medium tracking-tight">
          Offline QR Ferry
        </h1>
        <div
          data-testid="transport-explanation"
          className="mt-2 border border-[var(--cv-line)] bg-[var(--cv-paper)] p-4 text-sm leading-relaxed text-neutral-700"
        >
          <p>
            This is a <strong>tamper-evident transport envelope</strong>, not
            cryptographic payer authorization. A deterministic checksum
            (blake2b256 over a canonical encoding) detects any change to item,
            quantity, amount, merchant address, payer address, nonce, or
            expiry. Replay is defended by a consume-once nonce stored in
            localStorage on the importing device. No signature or
            authorization is implied — the connected device must still approve
            any payment.
          </p>
          <p className="mt-2 text-neutral-500">
            Demo scope: localStorage nonces persist across refresh but are
            device-local. Production requires an on-chain nonce registry or
            trusted sponsor index.
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {/* --- Generate panel (offline device) --- */}
        <div
          data-testid="generate-panel"
          className="flex flex-col gap-4 border border-[var(--cv-line)] bg-white p-5"
        >
          <div>
            <h2 className="text-lg font-medium tracking-tight">
              Offline device
            </h2>
            <p className="cv-micro cv-micro-sm mt-1 text-neutral-500">
              Generate envelope
            </p>
          </div>

          {/* Demo purchase summary */}
          <div className="border border-[var(--cv-line)] p-4">
            <p className="cv-micro cv-micro-sm text-neutral-500">
              Demo purchase (simulation)
            </p>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Item</dt>
                <dd className="font-medium">{DEMO_ITEM}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Quantity</dt>
                <dd className="font-mono tabular-nums">{DEMO_QUANTITY}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Unit price</dt>
                <dd className="font-mono tabular-nums">
                  {mistToSui(DEMO_UNIT_PRICE_MIST.toString())} SUI
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Total</dt>
                <dd className="font-mono tabular-nums">
                  {mistToSui(DEMO_TOTAL_MIST.toString())} SUI
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Merchant</dt>
                <dd className="font-medium">{DEMO_MERCHANT_NAME}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Merchant address</dt>
                <dd className="font-mono text-xs">{DEMO_MERCHANT_ADDRESS}</dd>
              </div>
            </dl>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            className="min-h-11 w-full bg-black px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
          >
            Generate envelope
          </button>

          {envelope && (
            <div className="flex flex-col gap-4">
              {/* QR code */}
              <div className="flex justify-center border border-[var(--cv-line)] p-4">
                <QRCodeSVG
                  value={envelopeJson}
                  size={200}
                  level="M"
                  marginSize={4}
                  fgColor="#000000"
                  bgColor="#ffffff"
                  title="Offline QR Ferry envelope"
                />
              </div>

              {/* Payload */}
              <div>
                <p className="cv-micro cv-micro-sm text-neutral-500">
                  Payload (JSON)
                </p>
                <pre
                  data-testid="envelope-payload"
                  className="mt-1 max-h-48 overflow-auto border border-[var(--cv-line)] bg-[var(--cv-paper)] p-3 font-mono text-xs whitespace-pre-wrap break-all"
                >
                  {envelopeJson}
                </pre>
              </div>

              {/* Copy + Download */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="min-h-11 flex-1 border border-black bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-100"
                >
                  Copy payload
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-11 flex-1 border border-black bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-100"
                >
                  Download payload
                </button>
              </div>

              {/* Envelope details */}
              <div className="border border-[var(--cv-line)] p-4 text-sm">
                <p className="cv-micro cv-micro-sm text-neutral-500">
                  Envelope details
                </p>
                <dl className="mt-3 flex flex-col gap-2">
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Nonce</dt>
                    <dd className="font-mono text-xs">{envelope.nonce}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Created</dt>
                    <dd className="font-mono text-xs">
                      {formatTime(envelope.createdAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Expires</dt>
                    <dd className="font-mono text-xs">
                      {formatTime(envelope.expiresAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Checksum</dt>
                    <dd className="font-mono text-xs">{envelope.checksum}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>

        {/* --- Import panel (connected device) --- */}
        <div className="flex flex-col gap-4 border border-[var(--cv-line)] bg-white p-5">
          <div>
            <h2 className="text-lg font-medium tracking-tight">
              Connected device
            </h2>
            <p className="cv-micro cv-micro-sm mt-1 text-neutral-500">
              Import and validate
            </p>
          </div>

          {/* Fail-closed degraded warning: replay storage is corrupt or
              wrong-shaped, so import/replay validation is unavailable until
              the user explicitly resets the QR nonce key. No nonce is
              auto-accepted. */}
          {replayDegraded && (
            <div
              role="alert"
              data-testid="replay-degraded-warning"
              className="border border-black bg-white p-4 text-sm leading-relaxed text-black"
            >
              <p className="font-semibold">
                Replay protection unavailable
              </p>
              <p className="mt-1">
                The local replay registry could not be loaded — its stored
                data is corrupt or misshapen, so import and replay validation
                are blocked. No envelope can be accepted until replay storage
                is deliberately reset.
              </p>
              <button
                type="button"
                onClick={handleRecoverReplayStorage}
                className="mt-3 min-h-11 w-full border border-black bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-100"
              >
                Reset replay storage
              </button>
              <p className="mt-2 text-neutral-500">
                This clears only the QR Ferry nonce key and reconstructs
                protection. Other stored data is untouched.
              </p>
            </div>
          )}

          {/* Paste textarea */}
          <div>
            <label
              htmlFor="qr-ferry-payload"
              className="cv-micro cv-micro-sm text-neutral-500"
            >
              Paste envelope payload
            </label>
            <textarea
              id="qr-ferry-payload"
              placeholder="Paste envelope payload JSON…"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={6}
              className="mt-1 w-full resize-y border border-[var(--cv-line)] bg-white p-3 font-mono text-xs"
            />
          </div>

          {/* File import */}
          <div>
            <label
              htmlFor="qr-ferry-file"
              className="cv-micro cv-micro-sm text-neutral-500"
            >
              Import from file
            </label>
            <input
              id="qr-ferry-file"
              type="file"
              accept=".json,.txt,application/json,text/plain"
              onChange={handleFile}
              className="mt-1 block w-full text-sm file:min-h-11 file:mr-3 file:border file:border-black file:bg-white file:px-4 file:py-2 file:font-semibold file:text-black hover:file:bg-neutral-100"
            />
          </div>

          <button
            type="button"
            onClick={handleImport}
            disabled={replayDegraded || payload.trim().length === 0}
            className="min-h-11 w-full bg-black px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            Import and validate
          </button>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="border border-black bg-white p-4 text-sm font-medium text-black"
            >
              {error}
            </div>
          )}

          {/* Validated envelope review */}
          {imported && (
            <div
              data-testid="validated-envelope"
              role="status"
              className="border border-black p-4"
            >
              <p className="cv-micro cv-micro-sm text-neutral-500">
                Validated envelope
              </p>
              <dl className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Item</dt>
                  <dd className="font-medium">{imported.item}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Quantity</dt>
                  <dd className="font-mono tabular-nums">
                    {imported.quantity}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Total</dt>
                  <dd className="font-mono tabular-nums">
                    {mistToSui(imported.totalMist)} SUI
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Merchant address</dt>
                  <dd className="font-mono text-xs">
                    {imported.merchantAddress}
                  </dd>
                </div>
                {imported.payerAddress && (
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Payer address</dt>
                    <dd className="font-mono text-xs">
                      {imported.payerAddress}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Expiry</dt>
                  <dd className="font-mono text-xs">
                    {formatTime(imported.expiresAt)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Nonce</dt>
                  <dd className="font-mono text-xs">{imported.nonce}</dd>
                </div>
              </dl>
              <p className="mt-4 border-t border-[var(--cv-line)] pt-3 text-sm font-semibold">
                Ready to hand off into payment action
              </p>
              <button
                type="button"
                onClick={handoffToCheckout}
                className="mt-3 min-h-11 w-full border border-black bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-100"
              >
                Continue to checkout
              </button>
              <p className="mt-2 text-xs text-neutral-500">
                This keeps QR Ferry as transport only. Checkout still applies the same deterministic payment gate.
              </p>
            </div>
          )}
        </div>
      </div>

      {checkoutPreview && (
        <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 md:p-5">
          <div className="mb-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
              Connected checkout
            </p>
            <h2 className="mt-1 text-lg font-medium tracking-tight">
              Payment action handoff
            </h2>
          </div>
          <PaymentAction preview={checkoutPreview} />
        </div>
      )}
    </section>
  );
}
