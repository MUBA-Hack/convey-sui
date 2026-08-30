import type { Metadata } from "next";
import { QrFerry } from "@/components/commerce/qr-ferry";

export const metadata: Metadata = {
  title: "Continue elsewhere — Convey",
  description:
    "Carry an exact quote or payment request between devices, then reconnect, review, approve, and submit on Sui testnet.",
};

/**
 * Offline QR Ferry route.
 *
 * A thin server-component shell that mounts the client-side two-panel
 * QrFerry component. No transaction code lives here; the validated envelope
 * is exposed via the component's onValidatedEnvelope seam for a future
 * payment-action integration.
 */
export default function QrFerryPage() {
  return <QrFerry />;
}
