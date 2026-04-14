import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { parseRelayUrl } from "@/lib/routeUtils";
import { use$ } from "@/hooks/use$";
import { pool } from "@/services/nostr";
import { REPO_KIND } from "@/lib/nip34";
import RepositoriesPage from "./RepositoriesPage";
import NotFound from "./NotFound";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, GitBranch } from "lucide-react";
import type { Filter } from "applesauce-core/helpers";
import type { CountResponse } from "applesauce-relay";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Browse repositories on a specific relay.
 *
 * Route: /relay/:relaySegment
 *
 * The segment uses the same encoding as relay hints in repo URLs:
 *   - wss:// is stripped:   relay.ngit.dev
 *   - ws:// is URL-encoded: ws%3A%2F%2Frelay.example.com
 *
 * Examples:
 *   /relay/relay.ngit.dev          → wss://relay.ngit.dev
 *   /relay/relay.damus.io          → wss://relay.damus.io
 *   /relay/ws%3A%2F%2Flocalhost    → ws://localhost
 */
export default function RelayPage() {
  const { relaySegment } = useParams<{ relaySegment: string }>();

  if (!relaySegment) return <NotFound />;

  const relayUrl = parseRelayUrl(relaySegment);

  if (!relayUrl) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold">Invalid relay URL</p>
          <p className="text-muted-foreground text-sm">
            &ldquo;{relaySegment}&rdquo; could not be parsed as a relay address.
          </p>
        </div>
      </div>
    );
  }

  // Extract a human-readable label: strip the scheme for display
  const relayLabel = relayUrl.replace(/^wss?:\/\//, "").replace(/\/$/, "");

  return (
    <RepositoriesPage
      relayOverride={[relayUrl]}
      relayLabel={relayLabel}
      relayStatusBanner={<RelayStatusBanner relayUrl={relayUrl} />}
    />
  );
}

/** Inline banner showing connection status and repo count for a relay. */
function RelayStatusBanner({ relayUrl }: { relayUrl: string }) {
  const relayInst = useMemo(() => pool.relay(relayUrl), [relayUrl]);

  // Reactive connection state
  const connected = use$(() => relayInst.connected$, [relayInst]);

  // COUNT request for kind:30617 repo announcements on this relay.
  // pool.count() returns Observable<Record<relayUrl, CountResponse>>.
  // We sum across all relay responses (there will be one entry for our relay).
  const repoCount = use$(
    () =>
      (
        pool.count([relayUrl], { kinds: [REPO_KIND] } as Filter) as Observable<
          Record<string, CountResponse>
        >
      ).pipe(
        map((record) =>
          Object.values(record).reduce((sum, r) => sum + r.count, 0),
        ),
      ),
    [relayUrl],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Connection status */}
      <Badge
        variant={connected ? "default" : "secondary"}
        className={
          connected
            ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30 hover:bg-green-500/20"
            : "bg-muted text-muted-foreground border-border"
        }
      >
        {connected ? (
          <Wifi className="h-3 w-3 mr-1.5" />
        ) : (
          <WifiOff className="h-3 w-3 mr-1.5" />
        )}
        {connected === undefined
          ? "Connecting…"
          : connected
            ? "Connected"
            : "Disconnected"}
      </Badge>

      {/* Repo count from NIP-45 COUNT */}
      {repoCount !== undefined && (
        <Badge
          variant="secondary"
          className="bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20"
        >
          <GitBranch className="h-3 w-3 mr-1.5" />
          {repoCount.toLocaleString()} repositor
          {repoCount === 1 ? "y" : "ies"}
        </Badge>
      )}
    </div>
  );
}
