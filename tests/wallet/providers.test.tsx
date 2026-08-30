// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Tests for the wallet provider invariants that make seedless onboarding
 * judge-visible and safe:
 *
 *  - The OAuth redirect URL is pinned to the registered origin root, so a
 *    sign-in started on a deep product route never sends an unregistered
 *    redirect_uri and never navigates the main page away from that route.
 *  - Enoki wallets register only when both env values are present and the
 *    network is Enoki-supported. No faking live auth when config is missing.
 *  - No OAuth/API key material is written to the console or rendered to the DOM.
 *  - autoConnect is enabled so the same address/session is restored on return.
 */

const { createDAppKit, createDAppKitOptions, registerEnokiWallets, isEnokiNetwork, enokiNetwork } = vi.hoisted(() => ({
  createDAppKitOptions: { current: null as Record<string, unknown> | null },
  createDAppKit: vi.fn((opts: Record<string, unknown>) => {
    createDAppKitOptions.current = opts;
    return {
      networks: ["localnet", "testnet", "mainnet"],
      getClient: () => ({}),
      stores: {
        $wallets: { get: () => [] },
        $connection: { get: () => ({}) },
        $currentNetwork: { get: () => "testnet" },
        $currentClient: { get: () => ({}) },
      },
    };
  }),
  registerEnokiWallets: vi.fn(() => ({ unregister: vi.fn() })),
  isEnokiNetwork: vi.fn(() => true),
  enokiNetwork: { current: "testnet" as string },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  createDAppKit,
  DAppKitProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useCurrentClient: () => ({}),
  useCurrentNetwork: () => enokiNetwork.current,
}));

vi.mock("@mysten/enoki", () => ({
  isEnokiNetwork,
  registerEnokiWallets,
}));

vi.mock("@mysten/sui/jsonRpc", () => ({
  SuiJsonRpcClient: vi.fn(() => ({})),
}));

import { WalletProviders, dAppKit } from "@/components/wallet/providers";

const SECRET_API_KEY = "pk_test_secret_enoki_api_key";
const SECRET_CLIENT_ID = "google-oauth-client-id-secret";

beforeEach(() => {
  registerEnokiWallets.mockClear();
  isEnokiNetwork.mockReset();
  isEnokiNetwork.mockReturnValue(true);
  enokiNetwork.current = "testnet";
  vi.stubEnv("NEXT_PUBLIC_ENOKI_API_KEY", SECRET_API_KEY);
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", SECRET_CLIENT_ID);
  vi.stubEnv("NEXT_PUBLIC_SUI_NETWORK", "testnet");
  // jsdom defaults to http://localhost/; pin a deep path to prove the
  // redirect URL ignores the current page route.
  window.location.href = "http://localhost/qr-ferry";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WalletProviders — autoConnect restores the same session", () => {
  it("creates the dAppKit instance with autoConnect enabled", () => {
    // dAppKit is created at module load; the options were captured by the mock.
    expect(createDAppKitOptions.current).not.toBeNull();
    expect(createDAppKitOptions.current?.autoConnect).toBe(true);
  });

  it("exports a concrete dAppKit instance", () => {
    expect(dAppKit).toBeDefined();
    expect(typeof dAppKit.getClient).toBe("function");
  });
});

describe("WalletProviders — redirect URL preserves the originating route", () => {
  it("pins the redirect URL to the registered origin root, not the current deep path", async () => {
    render(React.createElement(WalletProviders, null, "children"));
    await waitFor(() => expect(registerEnokiWallets).toHaveBeenCalled());

    const calls = registerEnokiWallets.mock.calls as unknown as Array<
      [{ providers: { google: { redirectUrl: string } } }]
    >;
    const args = calls[0]![0];
    expect(args.providers.google.redirectUrl).toBe(`${window.location.origin}/`);
    // The deep page route must NOT leak into the redirect URI.
    expect(args.providers.google.redirectUrl).not.toContain("qr-ferry");
  });

  it("keeps the redirect URL at origin root even when the page route changes", async () => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${window.location.origin}/strategy`;
    render(React.createElement(WalletProviders, null, "children"));
    await waitFor(() => expect(registerEnokiWallets).toHaveBeenCalled());

    const calls = registerEnokiWallets.mock.calls as unknown as Array<
      [{ providers: { google: { redirectUrl: string } } }]
    >;
    const args = calls[0]![0];
    expect(args.providers.google.redirectUrl).toBe(`${window.location.origin}/`);
  });
});

describe("WalletProviders — no Enoki registration without config", () => {
  it("does not register Enoki wallets when the API key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENOKI_API_KEY", "");
    render(React.createElement(WalletProviders, null, "children"));
    // Allow effects to flush; registration must not happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(registerEnokiWallets).not.toHaveBeenCalled();
  });

  it("does not register Enoki wallets when the Google client id is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    render(React.createElement(WalletProviders, null, "children"));
    await new Promise((r) => setTimeout(r, 50));
    expect(registerEnokiWallets).not.toHaveBeenCalled();
  });

  it("does not register Enoki wallets on a non-Enoki network (localnet)", async () => {
    enokiNetwork.current = "localnet";
    isEnokiNetwork.mockReturnValue(false);
    render(React.createElement(WalletProviders, null, "children"));
    await new Promise((r) => setTimeout(r, 50));
    expect(registerEnokiWallets).not.toHaveBeenCalled();
  });
});

describe("WalletProviders — no secret material is exposed", () => {
  it("never writes API key or client id material to the console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    render(React.createElement(WalletProviders, null, "children"));
    await waitFor(() => expect(registerEnokiWallets).toHaveBeenCalled());

    for (const spy of [logSpy, errorSpy, warnSpy, infoSpy]) {
      for (const call of spy.mock.calls) {
        const text = call.map(String).join(" ");
        expect(text).not.toContain(SECRET_API_KEY);
        expect(text).not.toContain(SECRET_CLIENT_ID);
      }
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("does not render secret material into the DOM", async () => {
    const { container } = render(
      React.createElement(WalletProviders, null, "children"),
    );
    await waitFor(() => expect(registerEnokiWallets).toHaveBeenCalled());
    expect(container.textContent).not.toContain(SECRET_API_KEY);
    expect(container.textContent).not.toContain(SECRET_CLIENT_ID);
  });
});
