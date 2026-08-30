import type { Metadata } from "next";
import { QrFerry } from "@/components/commerce/qr-ferry";

export const metadata: Metadata = {
  title: "Pay offline — Convey",
  description:
    "Pay when the internet is unavailable. Create a payment code on an offline device, then scan or paste it on a connected device to approve and settle on Sui.",
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
