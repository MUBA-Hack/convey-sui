import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline — Convey",
  description:
    "Offline shell for Convey. QR payload review remains local; settlement needs reconnection.",
  robots: { index: false, follow: false },
};

/**
 * Offline fallback shell.
 *
 * Served by the service worker when a navigation request fails and the
 * network is unreachable. The messaging is deliberately precise:
 *   - QR payload review remains local (carried quotes or payment requests are
 *     stored on-device and can be inspected without a connection).
 *   - Settlement needs reconnection (no on-chain transfer, checkout, or
 *     transaction can complete offline — the app never claims otherwise).
 *
 * Black-on-white, 44px hit targets, no gradients, no emoji. The retry link
 * is a real anchor so a restored connection can re-enter the app.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-white text-black antialiased">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Offline
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
          You are offline
        </h1>
        <p className="mt-6 text-base leading-relaxed text-neutral-700">
          QR payload review remains local: carried quotes or payment requests
          already stored on this device can still be inspected without a
          connection.
        </p>
        <p className="mt-4 text-base leading-relaxed text-neutral-700">
          Settlement needs reconnection. No SUI transfer, checkout, or
          transaction can be signed or confirmed until your device reaches the
          Sui network again.
        </p>

        <div className="mt-10">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center border border-black bg-black px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Try reconnecting
          </Link>
        </div>
      </div>
    </main>
  );
}
