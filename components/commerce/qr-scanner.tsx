"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

export interface QrScannerProps {
  onDecode: (text: string) => void;
  disabled?: boolean;
}

type ScanStatus = "idle" | "scanning" | "error";
const PERMISSION_ERRORS = new Set(["NotAllowedError", "SecurityError"]);
const MISSING_CAMERA_ERRORS = new Set([
  "NotFoundError",
  "OverconstrainedError",
  "DevicesNotFoundError",
]);

function friendlyCameraError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (PERMISSION_ERRORS.has(name)) {
    return "Camera permission denied. You can still paste or open a code.";
  }
  if (MISSING_CAMERA_ERRORS.has(name)) {
    return "No camera found. You can still paste or open a code.";
  }
  return "Could not start the camera. You can still paste or open a code.";
}

export function QrScanner({ onDecode, disabled = false }: QrScannerProps) {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const stopScan = useCallback(() => {
    const controls = controlsRef.current;
    controlsRef.current = null;
    if (controls) {
      try {
        controls.stop();
      } catch {
        return;
      }
    }
  }, []);

  const startScan = useCallback(async () => {
    if (disabled) return;
    setError(null);
    setStatus("scanning");
    try {
      const reader = readerRef.current ?? new BrowserQRCodeReader();
      readerRef.current = reader;
      const video = videoRef.current;
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video ?? undefined,
        (result, _err, ctrl) => {
          if (result) {
            const text = result.getText();
            ctrl.stop();
            controlsRef.current = null;
            setStatus("idle");
            onDecodeRef.current(text);
          }
        },
      );
      controlsRef.current = controls;
    } catch (err) {
      controlsRef.current = null;
      setStatus("error");
      setError(friendlyCameraError(err));
    }
  }, [disabled]);

  const cancelScan = useCallback(() => {
    stopScan();
    setStatus("idle");
    setError(null);
  }, [stopScan]);

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, [stopScan]);

  if (status === "scanning") {
    return (
      <div data-testid="qr-scanner-active" className="mt-3 flex flex-col gap-3">
        <div className="overflow-hidden rounded-lg border border-black/10 bg-black">
          <video
            ref={videoRef}
            data-testid="qr-scanner-video"
            className="mx-auto block max-h-64 w-full bg-black"
            muted
            playsInline
            autoPlay
          />
        </div>
        <button
          type="button"
          data-hit-target="true"
          onClick={cancelScan}
          className="cv-btn-ghost inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Cancel scan
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <button
        type="button"
        data-hit-target="true"
        data-testid="scan-qr-button"
        onClick={startScan}
        disabled={disabled}
        className="cv-btn-solid inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        Scan QR
      </button>

      {status === "error" && error && (
        <div
          role="alert"
          data-testid="qr-scanner-error"
          className="rounded-lg border border-black bg-white p-4 text-sm font-medium text-black"
        >
          {error}
        </div>
      )}
    </div>
  );
}
