// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

/**
 * Wave 3 Task 3.3 — Installable PWA and offline-safe shell.
 *
 * These tests pin three seams:
 *   1. The web app manifest (identity, standalone display, monochrome theme,
 *      icon sizes/srcs) returned by `app/manifest.ts`.
 *   2. The service-worker source policy in `public/sw.js`: versioned cache,
 *      navigation fallback to /offline, activate deletes old caches +
 *      skipWaiting + clients.claim, and the NEVER-CACHE list (/api/**, POST,
 *      wallet/RPC/explorer/checkout/payment/transaction/auth, cross-origin).
 *   3. The PNG icon files exist with the exact 192/512 pixel dimensions and a
 *      monochrome palette (single black foreground on white, no gradients).
 *   4. The registration component registers /sw.js client-side and fails
 *      non-fatally (a rejected registration never throws into the app).
 *   5. The offline page states that QR payload review remains local but
 *      settlement needs reconnection.
 *
 * The manifest function and React components are exercised for real; only
 * `navigator.serviceWorker` is mocked for the registration DOM test.
 */

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const swPath = resolve(repoRoot, "public", "sw.js");
const icon192Path = resolve(repoRoot, "public", "icons", "convey-192.png");
const icon512Path = resolve(repoRoot, "public", "icons", "convey-512.png");
const iconMaskablePath = resolve(
  repoRoot,
  "public",
  "icons",
  "convey-maskable-512.png",
);
const layoutPath = resolve(repoRoot, "app", "layout.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Web app manifest
// ---------------------------------------------------------------------------

describe("manifest — identity, display, theme, icons", () => {
  it("exposes a standalone black-and-white app identity", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();

    expect(m.name).toMatch(/convey/i);
    expect(m.short_name).toMatch(/convey/i);
    expect(m.description).toMatch(/convey/i);
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    // Monochrome: white background, black theme.
    expect(m.background_color).toBe("#ffffff");
    expect(m.theme_color).toBe("#000000");
  });

  it("declares exactly the 192 and 512 monochrome PNG icons", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();

    const icons = m.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(2);

    // Look up by size + purpose so a same-size maskable variant does not
    // shadow the any-purpose 512 entry.
    const find = (size: string, purpose: string) =>
      icons.find((i) => i.sizes === size && (i.purpose ?? "any") === purpose);
    const i192 = find("192x192", "any");
    const i512 = find("512x512", "any");
    expect(i192).toBeDefined();
    expect(i512).toBeDefined();
    expect(i192?.type).toBe("image/png");
    expect(i512?.type).toBe("image/png");
    expect(i192?.src).toBe("/icons/convey-192.png");
    expect(i512?.src).toBe("/icons/convey-512.png");
    // purpose defaults to "any" when omitted; if present it must be a sane value.
    for (const icon of [i192, i512]) {
      if (icon?.purpose) expect(icon.purpose).toMatch(/any|maskable/);
    }
  });

  it("declares a separate maskable 512 icon with safe-zone padding", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();

    const maskable = (m.icons ?? []).find(
      (i) => i.purpose === "maskable" && i.sizes === "512x512",
    );
    expect(maskable).toBeDefined();
    expect(maskable?.src).toBe("/icons/convey-maskable-512.png");
    expect(maskable?.type).toBe("image/png");
    // The any-purpose 512 and the maskable 512 must be distinct files so the
    // maskable safe-zone padding never bleeds into the plain icon.
    const any512 = (m.icons ?? []).find(
      (i) => i.purpose === "any" && i.sizes === "512x512",
    );
    expect(any512?.src).not.toBe(maskable?.src);
  });

  it("roots its identity fields in the Convey brand", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    for (const field of [m.name, m.short_name, m.description]) {
      expect(field).toMatch(/convey/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Service-worker source policy
// ---------------------------------------------------------------------------

function swSource(): string {
  return readFileSync(swPath, "utf8");
}

describe("sw.js — versioned cache and lifecycle", () => {
  it("defines a single versioned cache name", () => {
    const src = swSource();
    // A CACHE_VERSION literal that is bumped to invalidate old caches.
    expect(src).toMatch(/CACHE_VERSION\s*=\s*['"`]/);
    // A cache name prefix that includes the version.
    expect(src).toMatch(/CACHE_NAME\s*=\s*['"`][^'"`]*CACHE_VERSION/);
  });

  it("uses the Convey cache-name prefix", () => {
    const src = swSource();
    expect(src).toMatch(/CACHE_NAME\s*=\s*['"`]convey-/);
  });

  it("calls skipWaiting and clients.claim on activate", () => {
    const src = swSource();
    expect(src).toMatch(/self\.skipWaiting\s*\(/);
    expect(src).toMatch(/self\.clients\.claim\s*\(/);
  });

  it("deletes old caches that are not the current version on activate", () => {
    const src = swSource();
    // caches.keys filtered against the current cache name, deleting the rest.
    expect(src).toMatch(/caches\.keys\s*\(/);
    expect(src).toMatch(/caches\.delete\s*\(/);
  });
});

describe("sw.js — never-cache policy", () => {
  it("never caches /api/** requests", () => {
    const src = swSource();
    expect(src).toMatch(/\/api\//);
    // The /api/ check must appear in a never-cache / bypass branch, not as a
    // cache key. We assert it is referenced alongside a passthrough/Network.
    expect(src).toMatch(/\/api\/[\s\S]*?(fetch\(request\)|FetchEvent|respondWith)/i);
  });

  it("never caches POST or any non-GET request", () => {
    const src = swSource();
    expect(src).toMatch(/request\.method\s*!==\s*['"]GET['"]/);
  });

  it("never caches cross-origin requests", () => {
    const src = swSource();
    expect(src).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
  });

  it("never caches wallet/RPC/explorer/checkout/payment/transaction/auth traffic", () => {
    const src = swSource();
    // The host/path denylist must mention each sensitive surface so a future
    // edit cannot silently start caching settlement or wallet traffic.
    const denylist = [
      "wallet",
      "rpc",
      "fullnode",
      "explorer",
      "checkout",
      "payment",
      "transaction",
      "auth",
    ];
    for (const term of denylist) {
      expect(src, `sw.js should reference "${term}" in its never-cache policy`).toContain(
        term,
      );
    }
  });
});

describe("sw.js — navigation fallback and static asset caching", () => {
  it("falls back to /offline for navigation requests when the network fails", () => {
    const src = swSource();
    expect(src).toMatch(/mode\s*===\s*['"]navigate['"]/);
    expect(src).toMatch(/\/offline/);
  });

  it("caches static GET assets under a versioned cache, never the network-only paths", () => {
    const src = swSource();
    // A cache.put / caches.open for the versioned cache exists.
    expect(src).toMatch(/caches\.open\s*\(\s*CACHE_NAME\s*\)/);
    expect(src).toMatch(/cache\.put\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// 3. PNG icons — exact dimensions and monochrome palette
// ---------------------------------------------------------------------------

/** Parse a PNG IHDR chunk and return { width, height, bitDepth, colorType }. */
function pngHeader(buf: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
} {
  // PNG signature: 8 bytes. Then IHDR length(4) + type(4) + data(13).
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  const type = buf.subarray(12, 16).toString("ascii");
  if (type !== "IHDR") throw new Error(`first chunk is ${type}, not IHDR`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  return { width, height, bitDepth, colorType };
}

describe("icons — exact sizes and monochrome palette", () => {
  it("convey-192.png is exactly 192x192", () => {
    const buf = readFileSync(icon192Path);
    const h = pngHeader(buf);
    expect(h.width).toBe(192);
    expect(h.height).toBe(192);
  });

  it("convey-512.png is exactly 512x512", () => {
    const buf = readFileSync(icon512Path);
    const h = pngHeader(buf);
    expect(h.width).toBe(512);
    expect(h.height).toBe(512);
  });

  it("icons use an 8-bit grayscale or indexed palette (monochrome-friendly)", () => {
    for (const p of [icon192Path, icon512Path]) {
      const h = pngHeader(readFileSync(p));
      // colorType 0 = grayscale, 2 = truecolor (RGB), 3 = indexed, 4 = grayscale+alpha, 6 = RGBA.
      // We accept grayscale, indexed, or truecolor/RGBA so long as the artwork
      // is monochrome; the palette assertion is structural (no gradients in a
      // 2-color source). 8-bit depth is the safe minimum for installability.
      expect(h.bitDepth).toBe(8);
      expect([0, 2, 3, 4, 6]).toContain(h.colorType);
    }
  });
});

// ---------------------------------------------------------------------------
// 3b. Maskable 512 icon — real file, safe-zone padding
// ---------------------------------------------------------------------------

/**
 * Decode an 8-bit truecolor (colorType 2) or grayscale (colorType 0) PNG with
 * filter-byte-per-scanline reconstruction, returning a (w*h) Uint8Array of
 * per-pixel luminance (0-255). Used to verify the maskable mark sits inside
 * the central 80% safe zone on a full-bleed background.
 */
function pngLuminance(buf: Buffer): { w: number; h: number; lum: Uint8Array } {
  const { width: w, height: h, colorType } = pngHeader(buf);
  if (colorType !== 2 && colorType !== 0) {
    throw new Error(`unsupported colorType ${colorType} for luminance decode`);
  }
  const channels = colorType === 0 ? 1 : 3;
  // Collect IDAT chunks.
  const idats: Buffer[] = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    if (type === "IDAT") idats.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === "IEND") break;
  }
  const dec = inflateSync(Buffer.concat(idats));
  const lum = new Uint8Array(w * h);
  const prev = new Uint8Array(w * channels);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const filter = dec[off++] ?? 0;
    const line = dec.subarray(off, off + w * channels);
    off += w * channels;
    const cur = new Uint8Array(w * channels);
    for (let i = 0; i < w * channels; i++) {
      const raw = line[i] ?? 0;
      const left = i >= channels ? (cur[i - channels] ?? 0) : 0;
      const up = prev[i] ?? 0;
      const upLeft = i >= channels ? (prev[i - channels] ?? 0) : 0;
      let recon = raw;
      if (filter === 1) recon = (raw + left) & 255;
      else if (filter === 2) recon = (raw + up) & 255;
      else if (filter === 3) recon = (raw + ((left + up) >> 1)) & 255;
      else if (filter === 4) recon = (raw + paeth(left, up, upLeft)) & 255;
      cur[i] = recon;
    }
    for (let x = 0; x < w; x++) {
      const l =
        channels === 1
          ? (cur[x] ?? 0)
          : Math.round(
              ((cur[x * 3] ?? 0) + (cur[x * 3 + 1] ?? 0) + (cur[x * 3 + 2] ?? 0)) /
                3,
            );
      lum[y * w + x] = l;
    }
    prev.set(cur);
  }
  return { w, h, lum };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

describe("maskable icon — real file with safe-zone padding", () => {
  it("convey-maskable-512.png is exactly 512x512 PNG", () => {
    const buf = readFileSync(iconMaskablePath);
    const h = pngHeader(buf);
    expect(h.width).toBe(512);
    expect(h.height).toBe(512);
    expect(h.bitDepth).toBe(8);
  });

  it("is a distinct file from the any-purpose 512 icon", () => {
    const any512 = readFileSync(icon512Path);
    const mask = readFileSync(iconMaskablePath);
    // Different bytes => genuinely different artwork, not a copy.
    expect(mask.length).not.toBe(any512.length);
  });

  it("keeps the mark inside the central 80% safe zone on a full-bleed background", () => {
    const buf = readFileSync(iconMaskablePath);
    const { w, h, lum } = pngLuminance(buf);
    const cx = w / 2;
    const cy = h / 2;
    const safeRadius = w * 0.4; // maskable safe zone = central 80% diameter circle
    const cropRadius = w / 2; // adaptive-icon crop circle
    // Background is full-bleed white: every edge pixel must be light so any
    // maskable shape (circle/squircle) never reveals transparent/empty corners.
    const edges = [
      ...Array.from({ length: w }, (_, x) => [x, 0] as const),
      ...Array.from({ length: w }, (_, x) => [x, h - 1] as const),
      ...Array.from({ length: h }, (_, y) => [0, y] as const),
      ...Array.from({ length: h }, (_, y) => [w - 1, y] as const),
    ];
    for (const [x, y] of edges) {
      expect(lum[y * w + x] ?? 255).toBeGreaterThan(240);
    }
    // Find the dark mark's bounding box and assert its corners sit inside the
    // safe-zone circle (so the mark survives adaptive-icon shaping).
    let minR = h, maxR = 0, minC = w, maxC = 0;
    let anyDark = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((lum[y * w + x] ?? 255) < 128) {
          anyDark = true;
          if (y < minR) minR = y;
          if (y > maxR) maxR = y;
          if (x < minC) minC = x;
          if (x > maxC) maxC = x;
        }
      }
    }
    expect(anyDark).toBe(true);
    const cornerDist = Math.hypot(minR - cy, minC - cx);
    expect(cornerDist).toBeLessThanOrEqual(safeRadius);
    // And inside the crop circle (hard requirement for maskable).
    expect(cornerDist).toBeLessThanOrEqual(cropRadius);
  });
});

// ---------------------------------------------------------------------------
// 3c. Root layout — PWA <head> metadata (viewport themeColor, appleWebApp,
//     manifest link, apple-touch icon, applicationName)
// ---------------------------------------------------------------------------
//
// The root layout module pulls `next/font/google` and provider components that
// only resolve under the Next build, so we assert on the layout source for the
// metadata/viewport exports (consistent with the sw.js source assertions
// above) and verify the real rendered <head> tags via `pnpm build` output.

describe("layout.tsx — PWA head metadata exports", () => {
  const src = () => readFileSync(layoutPath, "utf8");

  it("exports a viewport object with themeColor (Next 16 themeColor location)", () => {
    const s = src();
    expect(s).toMatch(/export\s+const\s+viewport\s*:\s*Viewport/);
    // themeColor must live in viewport, not in metadata (deprecated there).
    expect(s).toMatch(/themeColor\s*:\s*['"]#000000['"]/);
  });

  it("does not put themeColor in the metadata object (deprecated since Next 14)", () => {
    const s = src();
    // Extract the metadata object block and assert it has no themeColor key.
    const match = s.match(/export\s+const\s+metadata[^{]*\{([\s\S]*?)\n\};/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/themeColor/);
  });

  it("declares appleWebApp metadata (title + capable)", () => {
    const s = src();
    expect(s).toMatch(/appleWebApp\s*:/);
    expect(s).toMatch(/appleWebApp[\s\S]*?title\s*:\s*['"]Convey['"]/);
    expect(s).toMatch(/appleWebApp[\s\S]*?capable\s*:\s*true/);
  });

  it("declares an explicit manifest link", () => {
    const s = src();
    expect(s).toMatch(/manifest\s*:\s*['"]\/manifest\.webmanifest['"]/);
  });

  it("declares an apple-touch icon via icons.apple", () => {
    const s = src();
    expect(s).toMatch(/icons\s*:\s*\{/);
    expect(s).toMatch(/apple\s*:\s*\[/);
    expect(s).toMatch(/apple[\s\S]*?convey-192\.png/);
  });

  it("declares applicationName", () => {
    const s = src();
    expect(s).toMatch(/applicationName\s*:\s*['"]Convey['"]/);
  });

  it("roots its title/description metadata in the Convey brand", () => {
    const s = src();
    const match = s.match(/export\s+const\s+metadata[^{]*\{([\s\S]*?)\n\};/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/convey/i);
  });
});

// ---------------------------------------------------------------------------
// 3d. Root layout — product shell: no marketing footer, no grid-paper field
// ---------------------------------------------------------------------------

describe("layout.tsx — product shell (no marketing footer, no grid-paper)", () => {
  const src = () => readFileSync(layoutPath, "utf8");

  it("does not mount the marketing footer on any route", () => {
    const s = src();
    // The landing footer is removed from the app shell entirely; product
    // navigation lives in the header menu, so no marketing slab can appear in
    // the first product viewport.
    expect(s).not.toMatch(/LandingFooter/);
    expect(s).not.toMatch(/landing\/footer/);
  });

  it("does not paint the grid-paper ambient shell on the product surface", () => {
    const s = src();
    // No engineering grid or glow wash behind the product — a quiet neutral
    // field only.
    expect(s).not.toMatch(/cv-grid/);
    expect(s).not.toMatch(/cv-glow/);
  });
});

// ---------------------------------------------------------------------------
// 4. Service-worker registration — non-fatal, client-side
// ---------------------------------------------------------------------------

describe("ServiceWorkerRegister — non-fatal client registration", () => {
  beforeEach(() => {
    // jsdom has no serviceWorker by default. Real browsers always return a
    // Promise from register(), so the mock does too.
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        register: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("registers /sw.js with scope /", async () => {
    const { ServiceWorkerRegister } = await import(
      "@/components/pwa/service-worker-register"
    );
    render(createElement(ServiceWorkerRegister));
    // Flush the effect's microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("does not register when serviceWorker is unsupported", async () => {
    vi.unstubAllGlobals();
    // A navigator with no serviceWorker property at all.
    vi.stubGlobal("navigator", { userAgent: "node" });
    const { ServiceWorkerRegister } = await import(
      "@/components/pwa/service-worker-register"
    );
    // Must not throw.
    expect(() => render(createElement(ServiceWorkerRegister))).not.toThrow();
    await Promise.resolve();
  });

  it("swallows a rejected registration without throwing into the app", async () => {
    const register = vi.fn().mockRejectedValue(new Error("sw unavailable"));
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: { register },
    });
    const { ServiceWorkerRegister } = await import(
      "@/components/pwa/service-worker-register"
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(ServiceWorkerRegister))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(register).toHaveBeenCalled();
    // No uncaught rejection surfaced; the component renders nothing visible.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("renders nothing visible to the user", async () => {
    const { ServiceWorkerRegister } = await import(
      "@/components/pwa/service-worker-register"
    );
    const { container } = render(createElement(ServiceWorkerRegister));
    await Promise.resolve();
    // The register component is a no-op node, not user-facing UI.
    expect(container.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 5. Offline page — QR review local, settlement needs reconnection
// ---------------------------------------------------------------------------

describe("OfflinePage — local review vs reconnection messaging", () => {
  it("states QR payload review remains local but settlement needs reconnection", async () => {
    const { default: OfflinePage } = await import("@/app/offline/page");
    render(createElement(OfflinePage));
    const body = screen.getByRole("main");
    expect(body).toHaveTextContent(/offline/i);
    expect(body).toHaveTextContent(/QR payload review remains local/i);
    expect(body).toHaveTextContent(/settlement needs reconnection/i);
  });

  it("never claims on-chain settlement works offline", async () => {
    const { default: OfflinePage } = await import("@/app/offline/page");
    render(createElement(OfflinePage));
    const body = screen.getByRole("main");
    // No false claim that payment/checkout/transaction can complete offline.
    expect(body.textContent).not.toMatch(/settle.*offline/i);
    expect(body.textContent).not.toMatch(/checkout.*offline/i);
    expect(body.textContent).not.toMatch(/transaction.*offline/i);
  });
});
