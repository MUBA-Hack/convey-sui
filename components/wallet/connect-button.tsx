"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  useDAppKit,
  useWalletConnection,
  useWallets,
} from "@mysten/dapp-kit-react";
import { isEnokiWallet, isGoogleWallet } from "@mysten/enoki";
import {
  ArrowDown2,
  Copy,
  CopySuccess,
  LogoutCurve,
  Refresh,
  Wallet,
  Warning2,
} from "@/components/icons";
import {
  classifySignInError,
  signInMessage,
  type SignInErrorKind,
  type SignInStage,
} from "@/components/wallet/sign-in-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// The v2 modal registers a browser custom element, so it must never be prerendered.
const ConnectModal = dynamic(
  () =>
    import("@mysten/dapp-kit-react/ui").then((module) => module.ConnectModal),
  { ssr: false },
);

function truncateAddress(address: string) {
  return address.length > 11
    ? `${address.slice(0, 5)}…${address.slice(-4)}`
    : address;
}

export function WalletConnectButton() {
  const dAppKit = useDAppKit();
  const connection = useWalletConnection();
  const wallets = useWallets();
  const [connectRequest, setConnectRequest] = useState(0);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInStage, setSignInStage] = useState<SignInStage>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic attempt id: invalidates the settle handler of a stale connect
  // promise so a late resolve/reject can't surface state on a newer attempt.
  // With idempotent connectWithGoogle there is never more than one in-flight
  // attempt, so this guard is defense-in-depth at the error/stale boundary.
  const signInAttempt = useRef(0);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    };
  }, []);

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  }

  async function disconnect() {
    setDisconnecting(true);
    setDisconnectError(false);
    try {
      await dAppKit.disconnectWallet();
      setMenuOpen(false);
    } catch {
      setDisconnectError(true);
    } finally {
      setDisconnecting(false);
    }
  }

  // Compact "Connecting…" trigger is reserved for an EXTERNAL connecting
  // state (a reconnect on mount, or another wallet's connect) — one this
  // component did NOT initiate. signInStage is the single authoritative
  // gate: "connecting" means a locally initiated Google sign-in is in
  // flight, which keeps the sign-in dialog mounted through the real
  // isConnecting transition and across a close/reopen while the attempt is
  // still pending. Any other stage lets the external compact trigger show.
  if (
    (connection.isConnecting || connection.isReconnecting) &&
    signInStage !== "connecting"
  ) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="cv-nav-chip"
        disabled
        aria-busy="true"
      >
        <Refresh
          size="16"
          variant="Linear"
          className="motion-safe:animate-spin"
          aria-hidden="true"
        />
        Connecting…
      </Button>
    );
  }

  if (!connection.account) {
    // Identify the Enoki/Google wallet by its metadata feature, NEVER by
    // display name — any extension can register a wallet-standard wallet
    // named "Google". Its presence is the honest signal that seedless auth is
    // configured; when it is absent we must not fake a Google button.
    const googleWallet = wallets.find(
      (wallet) => isEnokiWallet(wallet) && isGoogleWallet(wallet),
    );

    const openExtensionModal = () => {
      setSignInStage("idle");
      setConnectRequest((request) => request + 1);
    };

    const connectWithGoogle = async () => {
      // Idempotent: if a Google connect is already in flight (stage is
      // "connecting"), a second click or a reopen must not start another
      // OAuth call. There is never more than one concurrent attempt.
      if (signInStage === "connecting") return;
      if (!googleWallet) {
        openExtensionModal();
        return;
      }
      const attempt = ++signInAttempt.current;
      setSignInStage("connecting");
      try {
        await dAppKit.connectWallet({ wallet: googleWallet });
        if (signInAttempt.current === attempt) {
          setSignInStage("idle");
          setSignInOpen(false);
        }
      } catch (error) {
        if (signInAttempt.current !== attempt) return;
        setSignInStage(classifySignInError(error));
      }
    };

    const handleDialogChange = (open: boolean) => {
      setSignInOpen(open);
      if (!open && signInStage !== "connecting") {
        // Only reset when no attempt is in flight: a closed idle/error dialog
        // reopens clean, and invalidating the attempt id prevents a late
        // settle from a prior error attempt staining the reopened dialog.
        // While a connect is in flight the attempt stays alive across
        // close/reopen so the reopened dialog shows Connecting for the same
        // attempt — no second Google action or call is exposed.
        signInAttempt.current += 1;
        setSignInStage("idle");
      }
    };

    const errorKind: SignInErrorKind | null =
      signInStage === "blocked" || signInStage === "cancelled" || signInStage === "failed"
        ? signInStage
        : null;

    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="cv-nav-chip"
          onClick={() => setSignInOpen(true)}
        >
          <Wallet size="16" variant="Bold" aria-hidden="true" />
          Sign in
        </Button>
        <Dialog open={signInOpen} onOpenChange={handleDialogChange}>
          <DialogContent className="max-w-xs gap-4 p-6" aria-describedby={undefined}>
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-base">
                {googleWallet ? "Sign in" : "Connect a wallet"}
              </DialogTitle>
              {googleWallet ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Google creates your Sui account. No seed phrase. Every agreement still needs your approval.
                </p>
              ) : null}
            </DialogHeader>

            {signInStage === "connecting" ? (
              <div
                className="flex min-h-[48px] items-center justify-center gap-2.5 text-sm text-muted-foreground"
                aria-live="polite"
                aria-busy="true"
              >
                <Refresh
                  size="16"
                  variant="Linear"
                  className="motion-safe:animate-spin"
                  aria-hidden="true"
                />
                Connecting…
              </div>
            ) : errorKind ? (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-foreground" role="alert">
                  <Warning2
                    size="16"
                    variant="Linear"
                    className="mt-0.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span>{signInMessage(errorKind)}</span>
                </p>
                <Button
                  variant="outline"
                  className="min-h-[44px] w-full justify-center gap-2 font-semibold"
                  onClick={() => void connectWithGoogle()}
                >
                  <Refresh size="16" variant="Linear" aria-hidden="true" />
                  Try again
                </Button>
                {googleWallet ? (
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
                    onClick={openExtensionModal}
                  >
                    Use a wallet extension
                  </button>
                ) : null}
              </div>
            ) : googleWallet ? (
              <>
                <Button
                  variant="outline"
                  className="min-h-[48px] w-full justify-center gap-2.5 font-semibold"
                  onClick={() => void connectWithGoogle()}
                >
                  {googleWallet.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={googleWallet.icon}
                      alt=""
                      className="h-4.5 w-4.5"
                      aria-hidden="true"
                    />
                  ) : null}
                  Sign in with Google
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
                  onClick={openExtensionModal}
                >
                  Use a wallet extension
                </button>
              </>
            ) : (
              <Button
                variant="outline"
                className="min-h-[48px] w-full justify-center gap-2.5 font-semibold"
                onClick={openExtensionModal}
              >
                <Wallet size="16" variant="Bold" aria-hidden="true" />
                Connect a wallet
              </Button>
            )}
          </DialogContent>
        </Dialog>
        {connectRequest > 0 && (
          <ConnectModal key={connectRequest} open />
        )}
      </>
    );
  }

  const { address } = connection.account;

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="cv-nav-chip max-w-40 font-mono tabular-nums"
          aria-label={`Wallet ${address}`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-live"
            aria-hidden="true"
          />
          <span className="truncate">{truncateAddress(address)}</span>
          <ArrowDown2 size="14" variant="Linear" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="border-b border-border px-2 pb-2">
          <p className="text-xs font-medium text-ocean">Connected wallet</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {address}
          </p>
        </div>

        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void copyAddress(address)}
        >
          {copyState === "copied" ? (
            <CopySuccess size="17" variant="Bold" aria-hidden="true" />
          ) : (
            <Copy size="17" variant="Linear" aria-hidden="true" />
          )}
          <span aria-live="polite">
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy failed"
                : "Copy address"}
          </span>
        </button>

        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void disconnect()}
          disabled={disconnecting}
          aria-busy={disconnecting}
        >
          <LogoutCurve size="17" variant="Linear" aria-hidden="true" />
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>

        {disconnectError && (
          <p className="px-2 pb-1 text-xs text-destructive" role="alert">
            Couldn&apos;t disconnect. Try again.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
