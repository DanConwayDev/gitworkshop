/**
 * NwcQrConnect — NIP-47 wallet pairing via auth URI + QR code.
 *
 * Creates a fresh ephemeral WalletConnect client, renders its
 * `nostr+walletauth://...` URI as an SVG QR (via qrcode), and waits
 * for the wallet service to pair. When pairing completes, the resolved
 * `connectURI` is persisted via setWalletConnectUri and `onConnected` fires.
 *
 * Used by the Settings page and the ZapModal's connect-nwc step.
 */
import { useEffect, useMemo, useState } from "react";
import { WalletConnect } from "applesauce-wallet-connect";
import { generateSecretKey } from "nostr-tools";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";

import { pool } from "@/services/nostr";
import { setWalletConnectUri } from "@/services/wallet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const DEFAULT_NWC_AUTH_RELAY = "wss://relay.getalby.com/v1";

interface NwcQrConnectProps {
  onConnected: () => void;
  /** Display name advertised in the wallet auth URI. Defaults to "gitworkshop". */
  appName?: string;
  /** QR size in pixels. Defaults to 224. */
  size?: number;
}

export function NwcQrConnect({
  onConnected,
  appName = "gitworkshop",
  size = 224,
}: NwcQrConnectProps) {
  const [relay, setRelay] = useState(DEFAULT_NWC_AUTH_RELAY);
  const [error, setError] = useState<string | null>(null);

  // Fresh ephemeral client per relay change. Not stored — only the resolved
  // connectURI is persisted once the service pairs.
  const ephemeralWallet = useMemo(() => {
    setError(null);
    return new WalletConnect({
      pool,
      relays: [relay],
      secret: generateSecretKey(),
    });
  }, [relay]);

  const authUri = useMemo(() => {
    return ephemeralWallet.getAuthURI({
      methods: ["pay_invoice"],
      name: appName,
      expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    });
  }, [ephemeralWallet, appName]);

  const [qrSvg, setQrSvg] = useState<string>("");
  useEffect(() => {
    QRCode.toString(authUri, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setQrSvg)
      .catch(() => setQrSvg(""));
  }, [authUri]);

  useEffect(() => {
    const controller = new AbortController();
    ephemeralWallet
      .waitForService(controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        const uri = ephemeralWallet.connectURI;
        if (!uri) {
          setError("Wallet paired but no connection URI was issued.");
          return;
        }
        setWalletConnectUri(uri);
        onConnected();
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Pairing failed");
      });
    return () => controller.abort();
  }, [ephemeralWallet, onConnected]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Scan with an NWC-compatible wallet, or open the link on the same device.
      </p>

      <div className="flex flex-col items-center gap-2">
        <a
          href={authUri}
          target="_blank"
          rel="noreferrer"
          title="Open in wallet app"
          className="inline-block bg-white p-3 rounded-md border"
        >
          <div
            className="block"
            style={{ width: size, height: size }}
            // SVG is generated locally from a URI we just built — no user input.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </a>
        <a
          href={authUri}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline break-all max-w-full"
        >
          Open in wallet app
        </a>
      </div>

      <div className="space-y-1">
        <Label className="text-sm">Auth relay</Label>
        <Input
          value={relay}
          onChange={(e) => setRelay(e.target.value)}
          placeholder="wss://relay.example.com"
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Your wallet must pair via the same relay. The default works for most
          users.
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for wallet to pair…
      </p>
    </div>
  );
}
