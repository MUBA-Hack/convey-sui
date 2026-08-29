import type { Metadata } from "next";
import { QrFerry } from "@/components/commerce/qr-ferry";

export const metadata: Metadata = {
  title: "Offline QR Ferry — Convey",
  description:
    "Tamper-evident offline transport envelope for Convey commerce on Sui: generate a QR on an offline device, import and validate on a connected device, consume-once nonce replay defense.",
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
