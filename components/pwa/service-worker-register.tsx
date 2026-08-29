"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` client-side, non-fatally.
 *
 * Registration runs only in the browser, only when
 * `navigator.serviceWorker` exists, and any rejection is swallowed so a
 * failed/unavailable service worker can never break the app. The component
 * renders nothing — it is a side-effect-only node mounted once in the root
 * layout.
 *
 * `updateViaCache: "none"` ensures the browser always fetches the latest
 * worker script instead of serving a stale registration from HTTP cache.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const sw = (navigator as Partial<Navigator>).serviceWorker;
    if (!sw?.register) return;

    let cancelled = false;
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(
      (error) => {
        // Non-fatal: log and continue. The app still works without offline
        // support; we must never throw into the React tree from here.
        if (!cancelled) {
          console.warn("Service worker registration failed:", error);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
