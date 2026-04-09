/**
 * EventSearchStatus — shared UI component for displaying event search state.
 *
 * Renders per-relay status indicators grouped by relay group label, with
 * support for deletion/vanish detection and a "search more relays" button
 * for curated mode expansion.
 *
 * Used by IssuePage, PRPage, and potentially EventRedirect.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eventIdToNevent } from "@/lib/routeUtils";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  SearchX,
  Search,
  Trash2,
  UserX,
  XCircle,
  WifiOff,
  Clock,
} from "lucide-react";
import type {
  EventSearchState,
  RelayStatusEntry,
} from "@/hooks/useEventSearch";
import type { RelaySearchStatus } from "@/lib/searchForEvent";

// ---------------------------------------------------------------------------
// Relay status icon
// ---------------------------------------------------------------------------

function RelayStatusIcon({ status }: { status: RelaySearchStatus }) {
  switch (status) {
    case "connecting":
      return (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/50" />
      );
    case "searching":
      return (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500/70" />
      );
    case "eose":
      return (
        <AlertCircle className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      );
    case "found":
      return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />;
    case "error":
      return (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
      );
    case "connection-failed":
      return (
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
      );
    case "timeout":
      return <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" />;
  }
}

function RelayRow({ url, status }: { url: string; status: RelaySearchStatus }) {
  // Both "connection-failed" and "error" mean we couldn't reach the relay —
  // treat them identically in the UI.
  const isFailed = status === "connection-failed" || status === "error";
  const isTimeout = status === "timeout";

  return (
    <li className="flex items-center gap-2 text-xs font-mono py-0.5">
      <RelayStatusIcon status={status} />
      <span
        className={cn(
          "truncate flex-1",
          isFailed
            ? "line-through text-red-600/70 dark:text-red-400/70"
            : "text-muted-foreground",
        )}
      >
        {url}
      </span>
      {isFailed && (
        <span className="shrink-0 text-xs font-sans text-red-600 dark:text-red-400">
          connection failure
        </span>
      )}
      {isTimeout && (
        <span className="shrink-0 text-xs font-sans italic text-muted-foreground/60">
          no response
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Group relays by group label for display
// ---------------------------------------------------------------------------

interface RelayGroupDisplay {
  label: string;
  relays: { url: string; status: RelaySearchStatus }[];
}

function groupRelaysByLabel(
  relayStatuses: Record<string, RelayStatusEntry>,
): RelayGroupDisplay[] {
  const groups = new Map<
    string,
    { url: string; status: RelaySearchStatus }[]
  >();

  for (const [url, entry] of Object.entries(relayStatuses)) {
    const existing = groups.get(entry.group);
    if (existing) {
      existing.push({ url, status: entry.status });
    } else {
      groups.set(entry.group, [{ url, status: entry.status }]);
    }
  }

  return Array.from(groups.entries()).map(([label, relays]) => ({
    label,
    relays,
  }));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface EventSearchStatusProps {
  /** The search state from useEventSearch */
  search: EventSearchState;
  /** The event ID being searched for (displayed in the UI) */
  eventId?: string;
  /** Label for the item type (e.g. "Issue", "PR", "Event") */
  itemLabel: string;
  /** Path to navigate back to (e.g. "/issues") */
  backPath?: string;
  /** Label for the back link (e.g. "Back to issues") */
  backLabel?: string;
  /** Callback when user clicks "Search more relays" (curated mode) */
  onSearchMore?: () => void;
  /** Whether the "search more" action is currently active */
  searchMoreActive?: boolean;
}

export function EventSearchStatus({
  search,
  eventId,
  itemLabel,
  backPath,
  backLabel,
  onSearchMore,
  searchMoreActive,
}: EventSearchStatusProps) {
  const [copied, setCopied] = useState(false);

  const nevent = eventId ? eventIdToNevent(eventId) : undefined;

  function handleCopy() {
    if (!nevent) return;
    navigator.clipboard.writeText(nevent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  const isSearching =
    !search.found &&
    !search.concludedNotFound &&
    !search.deleted &&
    !search.vanished;

  // Deletion check is running: settled, no active relay group, and not yet concluded
  const isDeletionChecking =
    search.settled &&
    search.activeGroup === null &&
    !search.concludedNotFound &&
    !search.found &&
    !search.deleted &&
    !search.vanished;

  const groups = groupRelaysByLabel(search.relayStatuses);

  // Determine the headline
  let headline: string;
  let description: string;
  let icon: React.ReactNode;

  if (search.deleted) {
    headline = `${itemLabel} was deleted`;
    description = `The author published a deletion request for this ${itemLabel.toLowerCase()}.`;
    icon = <Trash2 className="h-8 w-8 text-destructive/70" />;
  } else if (search.vanished) {
    headline = "Author has vanished";
    description =
      "The author published a request to vanish (NIP-62), asking all relays to delete their events.";
    icon = <UserX className="h-8 w-8 text-muted-foreground" />;
  } else if (search.concludedNotFound) {
    headline = searchMoreActive
      ? `${itemLabel} not found on any searched relays`
      : `${itemLabel} not found on repository relays`;
    description = `No deletion request found either.`;
    icon = <SearchX className="h-8 w-8 text-muted-foreground" />;
  } else if (isSearching) {
    headline = search.activeGroup
      ? `Searching ${search.activeGroup}…`
      : "Searching relays…";
    description = `Looking for this ${itemLabel.toLowerCase()} on connected relays.`;
    icon = <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />;
  } else {
    // found — shouldn't render this component, but handle gracefully
    headline = `${itemLabel} found`;
    description = "";
    icon = <CheckCircle2 className="h-8 w-8 text-green-500" />;
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-12">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header + primary action */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="p-4 rounded-full bg-muted">{icon}</div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">{headline}</h2>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {onSearchMore && !search.found && !searchMoreActive && (
            <div className="flex flex-col items-center space-y-3">
              <Button onClick={onSearchMore} className="gap-2">
                <Search className="h-4 w-4" />
                Try more relays
              </Button>
              <p className="text-sm text-muted-foreground">
                Only maintainer-curated relays were searched.
                <br />
                {itemLabel} may exist on others.
              </p>
            </div>
          )}
        </div>

        {/* Event ID */}
        {nevent && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/40 px-3 py-2">
            <p className="text-xs font-mono text-muted-foreground/70 truncate">
              {nevent}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
              title="Copy nevent"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}

        {/* Relay status grouped by label */}
        {groups.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-4">
              {groups.map((group) => (
                <div key={group.label} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </p>
                  <ul className="space-y-1">
                    {group.relays.map(({ url, status }) => (
                      <RelayRow key={url} url={url} status={status} />
                    ))}
                  </ul>
                </div>
              ))}

              {/* Deletion check in-progress indicator */}
              {isDeletionChecking && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/70">
                    Checking for deletion requests…
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Back link */}
        {backPath && backLabel && (
          <div className="flex justify-center">
            <Link
              to={backPath}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {backLabel}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
