import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Archivo, Archivo_Narrow, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { WalletProviders } from "@/components/wallet/providers";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";

// Archivo carries every heading and paragraph; the big display sizes run at 400.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-sans" });
// Archivo Narrow carries every uppercase micro-label: eyebrows, chips, buttons.
const archivoNarrow = Archivo_Narrow({ subsets: ["latin"], variable: "--font-narrow" });
// Mono carries every hash, object id, digest, bps value and score in the UI.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Convey",
  description:
    "Convey — say it, carry it across, settle on Sui. Minimal black-and-white voice commerce: chat, voice, client-signed checkout, and offline payments.",
  applicationName: "Convey",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    title: "Convey",
    statusBarStyle: "black-translucent",
    capable: true,
  },
  icons: {
    icon: [
      { url: "/icons/convey-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/convey-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/convey-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

// Next.js 14+ moved themeColor out of `metadata` into the `viewport` export;
// emitting it here keeps <meta name="theme-color"> in the built <head>.
export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Light is the demo theme; every token lives in globals.css :root.
    <html
      lang="en"
      className={cn(
        "font-sans",
        archivo.variable,
        archivoNarrow.variable,
        geistMono.variable,
      )}
      suppressHydrationWarning
    >
      <body className="antialiased min-h-screen flex flex-col bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to content
        </a>

        <WalletProviders>
          {/* Product shell: the header carries all product navigation. No
              marketing footer renders on any route, so the first viewport is
              always the product surface, never a dead marketing slab. */}
          <div className="relative z-10 flex min-h-screen flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
          </div>
          {/* PWA: register /sw.js client-side, non-fatally. Renders nothing. */}
          <ServiceWorkerRegister />
        </WalletProviders>
      </body>
    </html>
  );
}
