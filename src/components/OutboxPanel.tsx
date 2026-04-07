/**
 * OutboxPanel — displays the publish queue with per-relay status.
 *
 * Shows all events that have been published (or are pending publish) with
 * a breakdown of which relays succeeded and which failed. Failed relays are
 * retried automatically by the outbox store (unless permanently rejected).
 *
 * Relay groups use semantic IDs:
 *   - "outbox:<pubkey>" → that pubkey's NIP-65 write relays
 *   - "inbox:<pubkey>"  → that pubkey's NIP-65 read relays (notification delivery)
 *   - "30617:<pubkey>:<d>" → repo relay coord
 *   - Other strings → displayed as-is
 */

import { use$ } from "@/hooks/use$";
import { useCountdown } from "@/hooks/useCountdown";
import {
  outboxStore,
  type OutboxItem,
  type OutboxRelayEntry,
  type RelayAttempt,
  type RelayStatus as OutboxRelayStatus,
} from "@/services/outbox";
import {
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RotateCw,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  LABEL_KIND,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  COMMENT_KIND,
  COVER_NOTE_KIND,
  REPO_KIND,
  getRepoName,
  extractSubject,
} from "@/lib/nip34";
import { NIP78_KIND } from "@/lib/notifications";
import { nip19 } from "nostr-tools";
import { useEventStore } from "@/hooks/useEventStore";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { RepoBadge } from "@/components/RepoBadge";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { eventIdToNevent } from "@/lib/routeUtils";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(kind: number): string {
  switch (kind) {
    case ISSUE_KIND:
      return "Issue";
    case PATCH_KIND:
      return "Patch";
    case PR_KIND:
      return "PR";
    case LABEL_KIND:
      return "Label";
    case STATUS_OPEN:
      return "Status: Open";
    case STATUS_RESOLVED:
      return "Status: Resolved";
    case STATUS_CLOSED:
      return "Status: Closed";
    case STATUS_DRAFT:
      return "Status: Draft";
    case COMMENT_KIND:
      return "Comment";
    case COVER_NOTE_KIND:
      return "Cover Note";
    case 7:
      return "Reaction";
    case 5:
      return "Deletion";
    case 0:
      return "Profile";
    case 1:
      return "Note";
    case 3:
      return "Contacts";
    case 10002:
      return "Relay List";
    case 10017:
      return "Git Authors List";
    case 10018:
      return "Git Repos List";
    case NIP78_KIND:
      return "App Data";
    default:
      return `Kind ${kind}`;
  }
}

/** Reactive relative-time span (e.g. "3 minutes ago"). */
function RelativeTime({ unixSeconds }: { unixSeconds: number }) {
  const label = useRelativeTime(unixSeconds);
  return (
    <span className="text-xs text-muted-foreground truncate">{label}</span>
  );
}

/**
 * Extract the repo name from the relay group IDs declared for this item.
 *
 * Group IDs like "30617:<pubkey>:<d>" identify the repo — look up the event
 * in the store to get the human-readable name.
 */
function repoNameFromGroups(
  groupIds: string[],
  store: ReturnType<typeof useEventStore>,
): string | undefined {
  for (const groupId of groupIds) {
    if (!groupId.startsWith("30617:")) continue;
    const parts = groupId.split(":");
    const pubkey = parts[1] ?? "";
    const dTag = parts[2] ?? "";
    if (!pubkey || !dTag) continue;
    const repoEvent = store.getReplaceable(REPO_KIND, pubkey, dTag);
    if (repoEvent) return getRepoName(repoEvent) || dTag;
    // Repo event not in store yet — fall back to the d-tag
    return dTag;
  }
  return undefined;
}

/**
 * Extract a human-readable context line for an outbox item.
 *
 * - Issues / Patches / PRs: "<repo name>: <subject>"
 * - Comments (kind 1111): "re: <parent subject>" (parent looked up from store)
 * - Status events: "<parent subject>" (parent looked up from store)
 * - Everything else: undefined (no context shown)
 *
 * Repo name is sourced from the relay groups already resolved on the item,
 * avoiding a redundant getReplaceable call.
 */
function useEventContext(
  item: OutboxItem,
): { label: string; path: string } | undefined {
  const store = useEventStore();
  const { event, relayGroupDefs } = item;
  const kind = event.kind;

  // Direct git events — subject is on the event itself
  if (kind === ISSUE_KIND || kind === PATCH_KIND || kind === PR_KIND) {
    const subject = extractSubject(event);
    const repoName = repoNameFromGroups(relayGroupDefs, store);
    const nevent = eventIdToNevent(event.id);
    const label = repoName ? `${repoName}: ${subject}` : subject;
    return { label, path: `/${nevent}` };
  }

  // Cover notes (kind 1624) — label shows the parent issue/PR subject,
  // link goes to the cover note event itself so the page can highlight it.
  if (kind === COVER_NOTE_KIND) {
    const rootId = event.tags.find(
      ([t, , , marker]) => t === "e" && marker === "root",
    )?.[1];
    if (rootId) {
      const rootEvent = store.getEvent(rootId);
      if (rootEvent) {
        const subject = extractSubject(rootEvent);
        const repoName = repoNameFromGroups(relayGroupDefs, store);
        const nevent = eventIdToNevent(event.id);
        const label = repoName
          ? `${repoName}: cover note on "${subject}"`
          : `cover note on "${subject}"`;
        return { label, path: `/${nevent}` };
      }
    }
    return undefined;
  }

  // Comments (kind 1111) — label shows the root context, link goes to the
  // comment itself so the anchor highlight and scroll-to work correctly.
  if (kind === COMMENT_KIND) {
    const rootId = event.tags.find(([t]) => t === "E")?.[1];
    if (rootId) {
      const rootEvent = store.getEvent(rootId);
      if (rootEvent) {
        const subject = extractSubject(rootEvent);
        const repoName = repoNameFromGroups(relayGroupDefs, store);
        // Link to the comment event itself — the page uses the nevent to
        // scroll to and highlight the specific reply.
        const nevent = eventIdToNevent(event.id);
        const label = repoName
          ? `${repoName}: re: ${subject}`
          : `re: ${subject}`;
        return { label, path: `/${nevent}` };
      }
    }
    return undefined;
  }

  // Deletion requests (kind 5) — label shows what was deleted, link goes to
  // the deleted event's thread if it can be resolved from the store.
  if (kind === 5) {
    const eTags = event.tags.filter(([t]) => t === "e");
    const targetId = eTags[0]?.[1];
    if (targetId) {
      const targetEvent = store.getEvent(targetId);
      if (targetEvent) {
        const repoName = repoNameFromGroups(relayGroupDefs, store);
        const nevent = eventIdToNevent(targetId);
        let subject: string;
        if (targetEvent.kind === COMMENT_KIND) {
          const rootId = targetEvent.tags.find(([t]) => t === "E")?.[1];
          const rootEvent = rootId ? store.getEvent(rootId) : undefined;
          subject = rootEvent
            ? `re: ${extractSubject(rootEvent)}`
            : `re: (unknown)`;
        } else if (targetEvent.kind === 7) {
          // Deleting a reaction — walk up to the reacted-to event
          const reactedId = targetEvent.tags
            .filter(([t]) => t === "e")
            .at(-1)?.[1];
          const reactedEvent = reactedId
            ? store.getEvent(reactedId)
            : undefined;
          const emoji = targetEvent.content || "+";
          subject = reactedEvent
            ? `${emoji} on "${extractSubject(reactedEvent)}"`
            : `reaction ${emoji}`;
        } else {
          subject = extractSubject(targetEvent);
        }
        const label = repoName
          ? `${repoName}: delete "${subject}"`
          : `delete "${subject}"`;
        return { label, path: `/${nevent}` };
      }
    }
    return undefined;
  }

  // Reactions (kind 7) — label shows what was reacted to.
  // Stars on repo announcements (kind:30617) link directly to the repo page.
  // All other reactions link to the reaction's own nevent permalink.
  if (kind === 7) {
    const eTags = event.tags.filter(([t]) => t === "e");
    const targetId = eTags[eTags.length - 1]?.[1];
    if (targetId) {
      const targetEvent = store.getEvent(targetId);
      if (targetEvent) {
        const emoji = event.content || "+";

        // Star on a repo announcement — nevent permalink redirects to the repo
        // page and highlights this stargazer in the popover.
        if (targetEvent.kind === REPO_KIND) {
          const repoName = getRepoName(targetEvent) || "repo";
          const nevent = eventIdToNevent(event.id);
          const label = `${emoji} ${repoName}`;
          return { label, path: `/${nevent}` };
        }

        const repoName = repoNameFromGroups(relayGroupDefs, store);
        const nevent = eventIdToNevent(event.id);
        // If the reaction targets a comment (kind 1111), walk up to the root
        // event for the subject and prefix with "re:" to show the hierarchy.
        let subject: string;
        if (targetEvent.kind === COMMENT_KIND) {
          const rootId = targetEvent.tags.find(([t]) => t === "E")?.[1];
          const rootEvent = rootId ? store.getEvent(rootId) : undefined;
          subject = rootEvent
            ? `re: ${extractSubject(rootEvent)}`
            : `re: (unknown)`;
        } else {
          subject = extractSubject(targetEvent);
        }
        const label = repoName
          ? `${repoName}: ${emoji} on "${subject}"`
          : `${emoji} on "${subject}"`;
        return { label, path: `/${nevent}` };
      }
    }
    return undefined;
  }

  // Git authors follow list (kind 10017) — link to the publisher's profile
  // "Followed Authors" tab.
  if (kind === 10017) {
    const npub = nip19.npubEncode(event.pubkey);
    return { label: "Followed Authors list", path: `/${npub}?tab=git-follows` };
  }

  // Git repos follow list (kind 10018) — link to the publisher's profile
  // "Followed" tab.
  if (kind === 10018) {
    const npub = nip19.npubEncode(event.pubkey);
    return { label: "Followed Repos list", path: `/${npub}?tab=followed` };
  }

  // Status events (1630–1633) — same pattern: label shows the root subject,
  // link goes to the status event itself for direct highlighting.
  if (
    kind === STATUS_OPEN ||
    kind === STATUS_RESOLVED ||
    kind === STATUS_CLOSED ||
    kind === STATUS_DRAFT
  ) {
    const rootId = event.tags.find(([t]) => t === "e")?.[1];
    if (rootId) {
      const rootEvent = store.getEvent(rootId);
      if (rootEvent) {
        const subject = extractSubject(rootEvent);
        const repoName = repoNameFromGroups(relayGroupDefs, store);
        const nevent = eventIdToNevent(event.id);
        const label = repoName ? `${repoName}: ${subject}` : subject;
        return { label, path: `/${nevent}` };
      }
    }
    return undefined;
  }

  return undefined;
}

/**
 * Render a rich label for a relay group ID.
 *
 * - "outbox:<pubkey>" → Avatar + username (own write relays)
 * - "inbox:<pubkey>"  → Avatar + username (notification inbox)
 * - "30617:<pubkey>:<d>" → maintainer avatar + "maintainer/repo-name"
 * - Other strings → displayed as-is
 */
function GroupLabel({ groupId }: { groupId: string }) {
  const store = useEventStore();

  // "outbox:<pubkey>" → NIP-65 write relays
  if (groupId.startsWith("outbox:")) {
    const pubkey = groupId.slice(7);
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">outbox:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <UserAvatar pubkey={pubkey} size="sm" className="h-4 w-4" />
          <UserName pubkey={pubkey} className="text-xs font-medium" />
        </span>
      </span>
    );
  }

  // "inbox:<pubkey>" → NIP-65 read relays (notification delivery)
  if (groupId.startsWith("inbox:")) {
    const pubkey = groupId.slice(6);
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">inbox:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <UserAvatar pubkey={pubkey} size="sm" className="h-4 w-4" />
          <UserName pubkey={pubkey} className="text-xs font-medium" />
        </span>
      </span>
    );
  }

  // Repo group: "30617:<pubkey>:<d>"
  if (groupId.startsWith("30617:")) {
    const parts = groupId.split(":");
    const pubkey = parts[1] ?? "";
    const dTag = parts[2] ?? groupId;
    // Pre-resolve the name from the store so RepoBadge can skip its own lookup.
    const repoEvent = pubkey
      ? store.getReplaceable(REPO_KIND, pubkey, dTag)
      : undefined;
    const resolvedName = repoEvent ? getRepoName(repoEvent) || dTag : undefined;

    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">repo:</span>
        <RepoBadge coord={groupId} repoName={resolvedName} />
      </span>
    );
  }

  // Static settings-based groups
  const STATIC_LABELS: Record<string, string> = {
    "extra-relays": "Extra Relays",
    "index-relays": "Index Relays",
    "git-index": "Git Index",
    "bootstrap-relays": "Bootstrap Relays",
  };
  if (groupId in STATIC_LABELS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
        <span>{STATIC_LABELS[groupId]}</span>
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">{groupId}</span>;
}

function itemStatus(
  item: OutboxItem,
): "success" | "partial" | "pending" | "failed" | "permanent" {
  if (item.broadlySent) return "success";

  const anySuccess = item.relays.some((r) => r.status === "success");
  const anyPending = item.relays.some(
    (r) => r.status === "pending" || r.status === "retrying",
  );
  const allPermanent = item.relays.every(
    (r) => r.status === "permanent" || r.status === "success",
  );

  if (anySuccess && anyPending) return "partial";
  if (anyPending) return "pending";
  if (allPermanent && !anySuccess) return "permanent";
  return "failed";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ReturnType<typeof itemStatus> }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "partial":
      return <CheckCircle2 className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "pending":
      return (
        <Clock className="h-4 w-4 text-muted-foreground shrink-0 animate-pulse" />
      );
    case "permanent":
      return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  }
}

function RelayStatusIcon({ status }: { status: OutboxRelayStatus }) {
  switch (status) {
    case "success":
      return (
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
      );
    case "permanent":
      return (
        <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0 mt-0.5" />
      );
    case "pending":
      return (
        <Clock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 animate-pulse" />
      );
    case "retrying":
      return (
        <RotateCw className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5 animate-spin" />
      );
    case "failed":
      return <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />;
  }
}

/**
 * Condense a raw relay message to a short (≤3 word) summary label.
 * The full message is shown in the expanded detail section.
 */
function shortSummary(
  status: OutboxRelayStatus,
  relay: OutboxRelayEntry,
): string {
  switch (status) {
    case "success":
      return relay.message === "duplicate" ? "already stored" : "accepted";
    case "permanent":
      return relay.permanentReason ?? "rejected";
    case "retrying":
      switch (relay.transientSubkind) {
        case "publish-timeout":
          return "no response";
        case "connection-timeout":
          return "connection timeout";
        case "connection-error":
          return "connection failed";
        default:
          return "rate limited";
      }
    case "pending":
      return "sending…";
    case "failed": {
      // "Timeout" is the exact string emitted by applesauce when no OK arrives
      if (relay.message === "Timeout") return "no response";
      const msg = relay.message.toLowerCase();
      if (
        /err_address_unreachable|err_name_not_resolved|err_connection_refused|econnrefused|enotfound|enetunreach|ehostunreach/i.test(
          relay.message,
        )
      )
        return "connection timeout";
      if (msg.includes("timeout") || msg.includes("timed out"))
        return "no response";
      if (
        msg.includes("websocket") ||
        msg.includes("connect") ||
        msg.includes("refused") ||
        msg.includes("socket")
      )
        return "connection failed";
      if (msg.includes("auth")) return "auth required";
      if (msg.includes("invalid")) return "invalid event";
      if (msg.includes("error")) return "relay error";
      return "failed";
    }
  }
}

function AttemptRow({ attempt }: { attempt: RelayAttempt }) {
  const label = useRelativeTime(attempt.at);
  return (
    <div className="flex items-start gap-1.5 py-0.5">
      {attempt.ok ? (
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <span className="text-muted-foreground/60 shrink-0">{label}</span>
        {attempt.message && (
          <span className="text-muted-foreground break-words block">
            {attempt.message}
          </span>
        )}
      </div>
    </div>
  );
}

function RelayRow({
  relay,
  itemId,
}: {
  relay: OutboxRelayEntry;
  itemId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canRetry =
    relay.status === "failed" ||
    relay.status === "retrying" ||
    relay.status === "permanent";
  const hasDetail =
    relay.message.length > 0 || (relay.attempts?.length ?? 0) > 0;
  const summary = shortSummary(relay.status, relay);
  const countdown = useCountdown(relay.retryAfter);

  const summaryColor =
    relay.status === "success"
      ? "text-green-600 dark:text-green-400"
      : relay.status === "permanent"
        ? "text-orange-500"
        : relay.status === "failed"
          ? "text-destructive"
          : relay.status === "retrying"
            ? "text-yellow-500"
            : "text-muted-foreground";

  // Attempts newest-first
  const attempts = relay.attempts ? [...relay.attempts].reverse() : [];

  return (
    <div className="py-1 text-xs">
      {/* Main row */}
      <div className="flex items-center gap-2">
        <RelayStatusIcon status={relay.status} />
        <span className="font-mono text-muted-foreground truncate flex-1 min-w-0">
          {relay.url}
        </span>
        <span className={`shrink-0 font-medium ${summaryColor}`}>
          {summary}
        </span>
        {/* Countdown to next automatic retry */}
        {relay.status === "retrying" && countdown && (
          <span className="shrink-0 tabular-nums text-muted-foreground/60">
            {countdown}
          </span>
        )}
        {hasDetail && (
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Hide detail" : "Show detail"}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
        {canRetry && (
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => outboxStore.retryRelay(itemId, relay.url)}
            aria-label="Retry relay"
            title="Retry now"
          >
            <RotateCw className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-1 ml-5 space-y-1 rounded border border-border bg-muted/40 px-2 py-1.5">
          {/* Attempt history, newest first */}
          {attempts.length > 0 && (
            <div className="space-y-0.5">
              {attempts.map((a, i) => (
                <AttemptRow key={i} attempt={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OutboxItemRow({
  item,
  onClose,
}: {
  item: OutboxItem;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = itemStatus(item);
  const successCount = item.relays.filter((r) => r.status === "success").length;
  const totalCount = item.relays.length;
  const context = useEventContext(item);

  return (
    <div
      className={
        "border-b last:border-b-0 " +
        (status === "failed" || status === "permanent"
          ? "bg-destructive/5"
          : status === "partial"
            ? "bg-yellow-500/5"
            : "")
      }
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs py-0 h-5 shrink-0">
              {kindLabel(item.event.kind)}
            </Badge>
            <RelativeTime unixSeconds={item.createdAt} />
          </div>
          {context ? (
            <div className="flex items-center gap-1 mt-0.5 min-w-0">
              <Link
                to={context.path}
                className="text-xs text-muted-foreground hover:text-foreground truncate flex items-center gap-1 min-w-0"
                title={context.label}
                onClick={onClose}
              >
                <span className="truncate">{context.label}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
              </Link>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-0.5">
              {successCount}/{totalCount} relays
            </div>
          )}
          {context && (
            <div className="text-xs text-muted-foreground">
              {successCount}/{totalCount} relays
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => outboxStore.dismiss(item.id)}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1">
          <OutboxItemDetail item={item} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutboxItemDetail — exported so OutboxStatusBadge can embed it in a popover
// ---------------------------------------------------------------------------

/**
 * Renders the per-relay-group breakdown for a single outbox item.
 * Used both in the expanded row inside OutboxPanel and in the popover
 * attached to OutboxStatusBadge on event cards.
 */
export function OutboxItemDetail({ item }: { item: OutboxItem }) {
  const allGroupIds = [...new Set(item.relays.flatMap((r) => r.groups))];

  return (
    <div className="space-y-2">
      {allGroupIds.map((groupId) => {
        const relaysForGroup = item.relays.filter((r) =>
          r.groups.includes(groupId),
        );
        const groupSuccess = relaysForGroup.filter(
          (r) => r.status === "success",
        ).length;
        return (
          <div
            key={groupId}
            className="rounded border border-border bg-muted/30"
          >
            <div className="flex items-center justify-between px-2 py-1 border-b border-border">
              <GroupLabel groupId={groupId} />
              <span className="text-muted-foreground/60 text-xs tabular-nums">
                {groupSuccess}/{relaysForGroup.length}
              </span>
            </div>
            <div className="px-2 py-1 space-y-0.5">
              {relaysForGroup.map((relay) => (
                <RelayRow key={relay.url} relay={relay} itemId={item.id} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type FilterMode = "all" | "pending" | "failed";

export function OutboxPanel({ onClose }: { onClose: () => void }) {
  const allItems = use$(outboxStore.items$) ?? [];
  // Filter out hidden items (e.g. notification state updates) from the UI
  const items = allItems.filter((i) => !i.hidden);
  const [filter, setFilter] = useState<FilterMode>("all");

  const pendingCount = items.filter((i) => !i.broadlySent).length;
  const failedCount = items.filter((i) =>
    i.relays.every((r) => r.status === "failed" || r.status === "permanent"),
  ).length;

  const filtered = items.filter((item) => {
    if (filter === "pending") return !item.broadlySent;
    if (filter === "failed")
      return item.relays.every(
        (r) => r.status === "failed" || r.status === "permanent",
      );
    return true;
  });

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-sm font-medium flex-1">Outbox</span>
        <div className="flex gap-1">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("all")}
          >
            All ({items.length})
          </Button>
          <Button
            variant={filter === "pending" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("pending")}
          >
            Pending
            {pendingCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-4 px-1 text-xs"
              >
                {pendingCount}
              </Badge>
            )}
          </Button>
          <Button
            variant={filter === "failed" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setFilter("failed")}
          >
            Failed
            {failedCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-4 px-1 text-xs"
              >
                {failedCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Items */}
      <ScrollArea className="max-h-[440px]">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
            {filter === "all" ? "No published events yet" : "Nothing here"}
          </div>
        ) : (
          filtered.map((item) => (
            <OutboxItemRow key={item.id} item={item} onClose={onClose} />
          ))
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Badge showing the count of pending (not broadly sent) outbox items.
 * Returns null when everything is sent.
 */
export function OutboxPendingBadge() {
  const allItems = use$(outboxStore.items$) ?? [];
  const pendingCount = allItems.filter(
    (i) => !i.hidden && !i.broadlySent,
  ).length;

  if (pendingCount === 0) return null;

  return (
    <Badge variant="destructive" className="h-4 min-w-4 px-1 text-xs">
      {pendingCount}
    </Badge>
  );
}
