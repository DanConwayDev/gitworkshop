/**
 * EventSearchStatus — shared UI component for displaying event search state.
 *
 * Renders per-relay status indicators grouped by relay group label, with
 * support for deletion/vanish detection and a "search more relays" button
 * for curated mode expansion.
 *
 * Used by IssuePage, PRPage, and potentially EventRedirect.
 */

import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  SearchX,
  Search,
  Trash2,
  UserX,
  XCircle,
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
      return <XCircle className="h-3 w-3 shrink-0 text-destructive/60" />;
  }
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
  const isSearching =
    !search.found &&
    !search.concludedNotFound &&
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
    headline = `${itemLabel} not found`;
    description = `This ${itemLabel.toLowerCase()} could not be found on any of the relays we searched.`;
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
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="p-4 rounded-full bg-muted">{icon}</div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">{headline}</h2>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {eventId && (
              <p className="text-xs font-mono text-muted-foreground/70 break-all">
                {eventId}
              </p>
            )}
          </div>
        </div>

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
                      <li
                        key={url}
                        className="flex items-center gap-2 text-xs font-mono text-muted-foreground"
                      >
                        <RelayStatusIcon status={status} />
                        <span className="truncate">{url}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Search more relays button (curated mode) */}
        {onSearchMore && !search.found && !searchMoreActive && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={onSearchMore}
              className="gap-1.5"
            >
              <Search className="h-3.5 w-3.5" />
              Search more relays
            </Button>
          </div>
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
