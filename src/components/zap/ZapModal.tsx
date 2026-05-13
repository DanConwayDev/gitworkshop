/**
 * ZapModal — multi-step NIP-57 zap flow.
 *
 *   select-amount → fetching-invoice → awaiting-payment
 *     ├─→ paying-webln → (close on success)
 *     ├─→ paying-nwc   → (close on success)
 *     └─→ connect-nwc  → awaiting-payment
 *
 * WebLN and NWC payments close the modal directly on their promise
 * resolution — we trust the wallet's confirmation as proof of payment.
 *
 * While the QR / awaiting-payment view is showing, a kind:9735 receipt watch
 * runs in parallel (live pool.subscription + the local EventStore that the
 * thread loader is already feeding). If the user scans the QR and pays
 * externally, the arriving receipt auto-closes the modal.
 *
 * An AbortController is created when payment starts and aborted on close to
 * stop in-flight wallet calls and suppress post-unmount state updates.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";
import { useActiveAccount } from "applesauce-react/hooks";
import { getZapRequest } from "applesauce-common/helpers";
import { WalletBaseError } from "applesauce-wallet-connect/helpers/error";
import { Subscription } from "rxjs";
import { Zap, Loader2, AlertCircle, Copy } from "lucide-react";

import { use$ } from "@/hooks/use$";
import { useLoadProfile } from "@/hooks/useLoadProfile";
import { useUser } from "@/hooks/useUser";
import { toast } from "@/hooks/useToast";
import {
  fetchLNURLPayEndpoint,
  fetchZapInvoice,
  pickZapRelays,
  signZapRequest,
  type LNURLPayEndpoint,
} from "@/lib/zap";
import { pool, eventStore } from "@/services/nostr";
import { fallbackRelays } from "@/services/settings";
import { useRepoRelays } from "@/contexts/RepoRelaysContext";
import {
  walletConnect$,
  setWalletConnectUri,
  hasWebLN,
  enableWebLN,
} from "@/services/wallet";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { QRCodeCanvas } from "@/components/ui/qrcode";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NwcQrConnect } from "@/components/zap/NwcQrConnect";

const PRESETS = [21, 100, 500, 1000, 5000, 10000] as const;

type Step =
  | "select-amount"
  | "fetching-invoice"
  | "awaiting-payment"
  | "paying-webln"
  | "paying-nwc"
  | "connect-nwc"
  | "error";

interface ZapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: NostrEvent;
  lnurl: string;
}

function describeWalletError(err: unknown): {
  message: string;
  canRetry: boolean;
} {
  if (err instanceof WalletBaseError) {
    switch (err.code) {
      case "INSUFFICIENT_BALANCE":
        return {
          message: "Wallet has insufficient balance for this zap.",
          canRetry: true,
        };
      case "QUOTA_EXCEEDED":
        return {
          message: "Wallet quota exceeded. Try a smaller amount.",
          canRetry: true,
        };
      case "UNAUTHORIZED":
        return {
          message: "Wallet not authorized. Reconnect it in Settings.",
          canRetry: false,
        };
      case "PAYMENT_FAILED":
        return {
          message: err.message || "Payment failed. Try again.",
          canRetry: true,
        };
      case "RATE_LIMITED":
        return { message: "Rate limited — wait a moment.", canRetry: true };
      default:
        return { message: err.message || err.code, canRetry: true };
    }
  }
  if (err instanceof Error) return { message: err.message, canRetry: true };
  return { message: "Payment failed.", canRetry: true };
}

export function ZapModal({ open, onOpenChange, event, lnurl }: ZapModalProps) {
  const account = useActiveAccount();
  useLoadProfile(event.pubkey);
  const recipient = useUser(event.pubkey);
  const recipientProfile = use$(() => recipient?.profile$, [recipient]);
  const recipientInboxes = use$(() => recipient?.inboxes$, [recipient]);
  const sender = useUser(account?.pubkey);
  const senderOutboxes = use$(() => sender?.outboxes$, [sender]);
  const repoRelays = useRepoRelays();
  const myFallbackRelays = use$(fallbackRelays);
  const wallet = use$(walletConnect$);
  const weblnAvailable = useMemo(() => hasWebLN(), []);

  // --- modal state ---
  const [step, setStep] = useState<Step>("select-amount");
  const [endpoint, setEndpoint] = useState<LNURLPayEndpoint | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [selectedSats, setSelectedSats] = useState<number>(1000);
  const [customSats, setCustomSats] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCanRetry, setErrorCanRetry] = useState<boolean>(true);
  const [nwcInput, setNwcInput] = useState<string>("");
  const [nwcError, setNwcError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const receiptSubsRef = useRef<Subscription[]>([]);

  const effectiveSats = useMemo(() => {
    if (customSats.trim()) {
      const n = Number(customSats);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return selectedSats;
  }, [customSats, selectedSats]);

  const amountMsats = effectiveSats * 1000;

  const sendable =
    endpoint &&
    endpoint.allowsNostr &&
    amountMsats >= endpoint.minSendable &&
    amountMsats <= endpoint.maxSendable;

  // --- cleanup helpers ---
  const teardownReceiptWatch = useCallback(() => {
    for (const sub of receiptSubsRef.current) sub.unsubscribe();
    receiptSubsRef.current = [];
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    teardownReceiptWatch();
  }, [teardownReceiptWatch]);

  // --- reset on close ---
  useEffect(() => {
    if (open) return;
    abort();
    // Delay reset slightly to avoid flicker during close animation
    const t = setTimeout(() => {
      setStep("select-amount");
      setInvoice(null);
      setErrorMessage(null);
      setErrorCanRetry(true);
      setMessage("");
      setNwcInput("");
      setNwcError(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open, abort]);

  // --- fetch LNURL endpoint on first open ---
  // Deps are intentionally just [open, lnurl]. Including `endpoint` or
  // `endpointLoading` causes the effect to cancel itself: `setEndpointLoading
  // (true)` would flip a dep, triggering cleanup (`cancelled = true`) before
  // the network even responds — so every state setter inside `.then`/`.finally`
  // would be skipped and the modal would hang on "loading".
  useEffect(() => {
    if (!open) return;
    if (endpoint) return; // already loaded for this recipient
    let cancelled = false;
    setEndpointLoading(true);
    setEndpointError(null);
    fetchLNURLPayEndpoint(lnurl)
      .then((ep) => {
        if (cancelled) return;
        setEndpoint(ep);
        if (!ep.allowsNostr)
          setEndpointError(
            "This recipient's lightning address does not support Nostr zaps.",
          );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEndpointError(
          err instanceof Error
            ? err.message
            : "Failed to load lightning address",
        );
      })
      .finally(() => {
        // Always clear loading — the request finished. `cancelled` only
        // suppresses applying the result, not the in-flight indicator.
        setEndpointLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lnurl]);

  // --- abort on unmount ---
  useEffect(() => {
    return () => abort();
  }, [abort]);

  // --- receipt watch ---
  // Runs only while the QR / awaiting-payment view is shown so an external
  // scan-and-pay (i.e. user scans the QR with a wallet on another device)
  // auto-closes the modal once the kind:9735 receipt lands. WebLN and NWC
  // payments close the modal directly on their promise resolution and never
  // depend on this.
  const startReceiptWatch = useCallback(
    (requestId: string, relays: string[]) => {
      teardownReceiptWatch();

      const onReceipt = (receipt: NostrEvent) => {
        const req = getZapRequest(receipt);
        if (req && req.id === requestId) {
          teardownReceiptWatch();
          toast({
            title: "Zap sent!",
            description: `${effectiveSats.toLocaleString()} sats delivered.`,
          });
          onOpenChange(false);
        }
      };

      // Path 1: short-lived pool subscription to the zap relays.
      try {
        const sub = pool
          .subscription(relays, {
            kinds: [kinds.Zap],
            "#p": [event.pubkey],
            "#e": [event.id],
            since: Math.floor(Date.now() / 1000) - 30,
          })
          .subscribe({
            next: onReceipt,
            error: (e) => console.warn("Zap receipt subscription error:", e),
          });
        receiptSubsRef.current.push(sub);
      } catch (e) {
        console.warn("Could not open zap receipt subscription:", e);
      }

      // Path 2: subscribe to the EventStore, which the existing thread loader
      // is already feeding. Useful when the LNURL provider publishes only to
      // relays we didn't list but the thread loader does query.
      try {
        const sub = eventStore
          .timeline([
            { kinds: [kinds.Zap], "#e": [event.id], "#p": [event.pubkey] },
          ])
          .subscribe({
            next: (events) => {
              for (const ev of events) onReceipt(ev);
            },
            error: (e) => console.warn("EventStore zap subscription error:", e),
          });
        receiptSubsRef.current.push(sub);
      } catch (e) {
        console.warn("Could not open EventStore zap subscription:", e);
      }
    },
    [event.id, event.pubkey, effectiveSats, teardownReceiptWatch, onOpenChange],
  );

  // --- step: build zap request, fetch invoice ---
  const proceedToInvoice = useCallback(async () => {
    if (!account?.signer || !endpoint || !sendable) return;

    setErrorMessage(null);
    setErrorCanRetry(true);
    setStep("fetching-invoice");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const relays = pickZapRelays(
        recipientInboxes,
        myFallbackRelays,
        8,
        repoRelays,
        senderOutboxes ?? [],
      );

      const zapRequest = await signZapRequest(
        account.signer,
        event,
        amountMsats,
        relays,
        message,
      );
      if (abortRef.current?.signal.aborted) return;

      const bolt11 = await fetchZapInvoice(
        endpoint.callback,
        zapRequest,
        amountMsats,
      );
      if (abortRef.current?.signal.aborted) return;

      setInvoice(bolt11);
      setStep("awaiting-payment");
      startReceiptWatch(zapRequest.id, relays);
    } catch (err) {
      if (abortRef.current?.signal.aborted) return;
      setErrorMessage(
        err instanceof Error ? err.message : "Could not fetch invoice.",
      );
      setStep("error");
    }
  }, [
    account?.signer,
    endpoint,
    sendable,
    recipientInboxes,
    senderOutboxes,
    myFallbackRelays,
    repoRelays,
    event,
    amountMsats,
    message,
    startReceiptWatch,
  ]);

  // --- WebLN payment ---
  const payWithWebLN = useCallback(async () => {
    if (!invoice || !window.webln) return;
    setStep("paying-webln");
    setErrorMessage(null);
    try {
      await enableWebLN();
      await window.webln.sendPayment(invoice);
      // Payment confirmed by the extension — we don't wait for the kind:9735
      // receipt. Close the modal; the sidebar zap total will update when the
      // receipt arrives via the existing thread loader.
      teardownReceiptWatch();
      toast({
        title: "Zap sent!",
        description: `${effectiveSats.toLocaleString()} sats delivered.`,
      });
      onOpenChange(false);
    } catch (err) {
      const { message: msg, canRetry } = describeWalletError(err);
      setErrorMessage(msg);
      setErrorCanRetry(canRetry);
      setStep("awaiting-payment"); // Stay on payment screen so user can retry
      toast({
        title: "WebLN payment failed",
        description: msg,
        variant: "destructive",
      });
    }
  }, [invoice, effectiveSats, onOpenChange, teardownReceiptWatch]);

  // --- NWC payment ---
  const payWithNWC = useCallback(async () => {
    if (!invoice || !wallet) return;
    setStep("paying-nwc");
    setErrorMessage(null);

    const controller = abortRef.current ?? new AbortController();
    abortRef.current = controller;

    try {
      if (!wallet.service) await wallet.waitForService(controller.signal);
      if (controller.signal.aborted) return;
      await wallet.payInvoice(invoice);
      if (controller.signal.aborted) return;
      // Same as WebLN — payment confirmed by the wallet, close immediately.
      teardownReceiptWatch();
      toast({
        title: "Zap sent!",
        description: `${effectiveSats.toLocaleString()} sats delivered.`,
      });
      onOpenChange(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      const { message: msg, canRetry } = describeWalletError(err);
      setErrorMessage(msg);
      setErrorCanRetry(canRetry);
      setStep("awaiting-payment");
      toast({
        title: "Wallet payment failed",
        description: msg,
        variant: "destructive",
      });
    }
  }, [invoice, wallet, effectiveSats, onOpenChange, teardownReceiptWatch]);

  // --- NWC inline connect ---
  const submitNwcUri = useCallback(() => {
    setNwcError(null);
    try {
      setWalletConnectUri(nwcInput.trim());
      setStep("awaiting-payment");
    } catch (err) {
      setNwcError(
        err instanceof Error ? err.message : "Invalid connection string",
      );
    }
  }, [nwcInput]);

  // --- copy invoice ---
  const copyInvoice = useCallback(() => {
    if (!invoice) return;
    navigator.clipboard.writeText(invoice).then(() => {
      toast({ title: "Invoice copied" });
    });
  }, [invoice]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const recipientName =
    recipientProfile?.displayName ||
    recipientProfile?.name ||
    `${event.pubkey.slice(0, 8)}…`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Zap {recipientName}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs truncate">
            {lnurl}
          </DialogDescription>
        </DialogHeader>

        {/* LNURL load error */}
        {endpointError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{endpointError}</span>
          </div>
        )}

        {/* ----- STEP: select-amount ----- */}
        {step === "select-amount" && (
          <div className="space-y-4">
            {endpointLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading lightning address…
              </div>
            )}

            <div>
              <Label className="text-sm">Amount (sats)</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {PRESETS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={
                      !customSats && selectedSats === s ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => {
                      setSelectedSats(s);
                      setCustomSats("");
                    }}
                  >
                    {s.toLocaleString()}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Custom amount"
                className="mt-2"
                value={customSats}
                onChange={(e) => setCustomSats(e.target.value)}
              />
              {endpoint && (
                <p className="text-xs text-muted-foreground mt-1">
                  Min {Math.ceil(endpoint.minSendable / 1000).toLocaleString()}{" "}
                  · Max{" "}
                  {Math.floor(endpoint.maxSendable / 1000).toLocaleString()}{" "}
                  sats
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="zap-message" className="text-sm">
                Message (optional)
              </Label>
              <Textarea
                id="zap-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Nice work!"
                rows={2}
                className="mt-1 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={proceedToInvoice}
                disabled={!sendable || endpointLoading}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                <Zap className="h-4 w-4 mr-1" />
                Zap {effectiveSats.toLocaleString()} sats
              </Button>
            </div>
          </div>
        )}

        {/* ----- STEP: fetching-invoice ----- */}
        {step === "fetching-invoice" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Building zap request and fetching invoice…
            </p>
          </div>
        )}

        {/* ----- STEP: awaiting-payment ----- */}
        {step === "awaiting-payment" && invoice && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-center">
              Pay{" "}
              <span className="font-bold">
                {effectiveSats.toLocaleString()}
              </span>{" "}
              sats to confirm your zap
            </p>

            <a
              href={`lightning:${invoice}`}
              className="inline-block bg-white p-3 rounded-md"
              title="Open in lightning wallet"
            >
              <QRCodeCanvas value={invoice} size={224} />
            </a>

            {errorMessage && (
              <div className="w-full rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 w-full">
              {weblnAvailable && (
                <Button
                  onClick={payWithWebLN}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Pay with browser extension
                </Button>
              )}
              {wallet ? (
                <Button onClick={payWithNWC} variant="outline">
                  <Zap className="h-4 w-4 mr-1" />
                  Pay with connected wallet
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setStep("connect-nwc")}
                >
                  Connect a wallet (NWC)
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={copyInvoice}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copy invoice
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Or scan with any lightning wallet — we'll detect the receipt
              automatically.
            </p>
          </div>
        )}

        {/* ----- STEP: paying-webln / paying-nwc ----- */}
        {(step === "paying-webln" || step === "paying-nwc") && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm text-muted-foreground">
              {step === "paying-webln"
                ? "Confirm in your browser extension…"
                : "Paying with connected wallet…"}
            </p>
          </div>
        )}

        {/* ----- STEP: connect-nwc ----- */}
        {step === "connect-nwc" && (
          <div className="space-y-3">
            <Tabs defaultValue="qr">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="qr">Scan QR</TabsTrigger>
                <TabsTrigger value="paste">Paste URI</TabsTrigger>
              </TabsList>

              <TabsContent value="qr">
                <NwcQrConnect
                  appName="gitworkshop zap"
                  size={192}
                  onConnected={() => setStep("awaiting-payment")}
                />
              </TabsContent>

              <TabsContent value="paste" className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Paste a Nostr Wallet Connect URI from your wallet (e.g. Alby,
                  Mutiny, ZBD, Coinos).
                </p>
                <Textarea
                  value={nwcInput}
                  onChange={(e) => setNwcInput(e.target.value)}
                  placeholder="nostr+walletconnect://..."
                  rows={3}
                  className="font-mono text-xs"
                />
                {nwcError && (
                  <p className="text-xs text-destructive">{nwcError}</p>
                )}
                <div className="flex justify-end">
                  <Button onClick={submitNwcUri} disabled={!nwcInput.trim()}>
                    Connect
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex justify-between items-center pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("awaiting-payment")}
              >
                Back
              </Button>
              <p className="text-xs text-muted-foreground">
                Tip: save a wallet permanently in Settings → Lightning Wallet.
              </p>
            </div>
          </div>
        )}

        {/* ----- STEP: error ----- */}
        {step === "error" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-sm text-center">
              {errorMessage ?? "Something went wrong."}
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {errorCanRetry && (
                <Button onClick={() => setStep("select-amount")}>
                  Try again
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
