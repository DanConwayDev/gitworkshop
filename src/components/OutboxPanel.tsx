/**
 * OutboxPanel — displays the publish queue with per-relay status.
 *
 * Shows all events that have been published (or are pending publish) with
 * a breakdown of which relays succeeded and which failed. Failed relays are
 * retried automatically by the outbox store (unless permanently rejected).
 *
 * Relay groups use semantic IDs:
 *   - 64-char hex pubkey → "your outbox" (if own pubkey) or "<name>'s inbox"
 *   - "30617:<pubkey>:<d>" → repo relay coord
 *   - Other strings → displayed as-is
 */

import { use$ } from "@/hooks/use$";
import {
  outboxStore,
  type OutboxItem,
  type OutboxRelayEntry,
  type RelayStatus as OutboxRelayStatus,
} from "@/services/outbox";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RotateCw,
  GitFork,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  REPO_KIND,
  getRepoName,
} from "@/lib/nip34";
import { useEventStore } from "@/hooks/useEventStore";
import { UserAvatar, UserName } from "@/components/UserAvatar";

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
    case 0:
      return "Profile";
    case 1:
      return "Note";
    case 3:
      return "Contacts";
    case 10002:
      return "Relay List";
    default:
      return `Kind ${kind}`;
  }
}

/**
 * Render a rich label for a relay group ID.
 *
 * - 64-char hex pubkey → Avatar + username (inbox)
 * - "30617:<pubkey>:<d>" → maintainer avatar + "maintainer/repo-name"
 * - Other strings → displayed as-is
 */
function GroupLabel({
  groupId,
  eventPubkey,
}: {
  groupId: string;
  eventPubkey: string;
}) {
  const store = useEventStore();

  // Inbox/outbox group: a pubkey
  if (/^[0-9a-f]{64}$/.test(groupId)) {
    const isOwn = groupId === eventPubkey;
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">
          {isOwn ? "outbox:" : "inbox:"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <UserAvatar pubkey={groupId} size="sm" className="h-4 w-4" />
          <UserName pubkey={groupId} className="text-xs font-medium" />
        </span>
      </span>
    );
  }

  // Repo group: "30617:<pubkey>:<d>"
  if (groupId.startsWith("30617:")) {
    const parts = groupId.split(":");
    const pubkey = parts[1] ?? "";
    const dTag = parts[2] ?? groupId;
    const repoEvent = pubkey
      ? store.getReplaceable(REPO_KIND, pubkey, dTag)
      : undefined;
    const repoName = repoEvent ? getRepoName(repoEvent) || dTag : dTag;

    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">repo:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <GitFork className="h-3 w-3 shrink-0" />
          {pubkey ? (
            <>
              <UserName pubkey={pubkey} className="text-xs font-medium" />
              <span className="text-muted-foreground font-normal">
                /{repoName}
              </span>
            </>
          ) : (
            <span>{repoName}</span>
          )}
        </span>
      </span>
    );
  }

  // Fallback for generic "relays" group (publish() with no coord)
  if (groupId === "relays") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">outbox:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <span>relays</span>
        </span>
      </span>
    );
  }

  // Fallback for "repo relays" well-known string (no coord available)
  if (groupId === "repo relays") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/60 text-xs">repo:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          <GitFork className="h-3 w-3 shrink-0" />
          <span>relays</span>
        </span>
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

function RelayRow({ relay }: { relay: OutboxRelayEntry }) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <RelayStatusIcon status={relay.status} />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-muted-foreground truncate block">
          {relay.url}
        </span>
        {relay.status === "permanent" && relay.permanentReason && (
          <span className="text-orange-500/80 truncate block">
            {relay.permanentReason}
          </span>
        )}
        {relay.status === "retrying" && relay.message && (
          <span className="text-muted-foreground/80 truncate block">
            retrying… ({relay.message})
          </span>
        )}
        {relay.status === "failed" && relay.message && (
          <span className="text-destructive/80 truncate block">
            {relay.message}
          </span>
        )}
      </div>
    </div>
  );
}

function OutboxItemRow({ item }: { item: OutboxItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = itemStatus(item);
  const successCount = item.relays.filter((r) => r.status === "success").length;
  const totalCount = item.relays.length;

  // Collect all unique group IDs across all relays
  const allGroupIds = [...new Set(item.relays.flatMap((r) => r.groups))];

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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs py-0 h-5 shrink-0">
              {kindLabel(item.event.kind)}
            </Badge>
            <span className="text-xs text-muted-foreground truncate">
              {formatDistanceToNow(new Date(item.createdAt * 1000), {
                addSuffix: true,
              })}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {successCount}/{totalCount} relays
          </div>
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
        <div className="px-3 pb-3 space-y-2 pt-1">
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
                  <GroupLabel
                    groupId={groupId}
                    eventPubkey={item.event.pubkey}
                  />
                  <span className="text-muted-foreground/60 text-xs tabular-nums">
                    {groupSuccess}/{relaysForGroup.length}
                  </span>
                </div>
                <div className="px-2 py-1 space-y-0.5">
                  {relaysForGroup.map((relay) => (
                    <RelayRow key={relay.url} relay={relay} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type FilterMode = "all" | "pending" | "failed";

export function OutboxPanel() {
  const items = use$(outboxStore.items$) ?? [];
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
    <div className="flex flex-col h-full">
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
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
            {filter === "all" ? "No published events yet" : "Nothing here"}
          </div>
        ) : (
          filtered.map((item) => <OutboxItemRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

/**
 * Badge showing the count of pending (not broadly sent) outbox items.
 * Returns null when everything is sent.
 */
export function OutboxPendingBadge() {
  const items = use$(outboxStore.items$) ?? [];
  const pendingCount = items.filter((i) => !i.broadlySent).length;

  if (pendingCount === 0) return null;

  return (
    <Badge variant="destructive" className="h-4 min-w-4 px-1 text-xs">
      {pendingCount}
    </Badge>
  );
}
