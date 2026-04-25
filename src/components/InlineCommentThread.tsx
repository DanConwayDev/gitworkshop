/**
 * InlineCommentThread — GitHub-style inline code review comment thread.
 *
 * Renders a list of inline comments anchored to a specific file/line in a
 * diff, plus an optional composer for adding new comments.
 *
 * Visual design mirrors GitHub's PR review comment threads:
 *   - Blue left border on the thread container
 *   - Each comment: avatar + author + time + body
 *   - "Reply" button opens an inline composer
 *   - "Add a comment" button at the bottom when no composer is open
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { NostrEvent } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  NostrComposer,
  type NostrComposerHandle,
} from "@/components/NostrComposer";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Reply,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { composerHasNsec, hasPreviewableContent } from "@/lib/composerUtils";
import { runner } from "@/services/actions";
import {
  CreateInlineComment,
  CreateComment,
  ResolveThread,
} from "@/actions/nip34";
import { DeleteEvent } from "@/actions/nip34";
import type { InlineCommentOptions } from "@/blueprints/inline-comment";
import {
  isInlineComment,
  parseInlineCommentLocation,
} from "@/blueprints/inline-comment";
import { useActiveAccount } from "applesauce-react/hooks";
import { useProfile } from "@/hooks/useProfile";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useToast } from "@/hooks/useToast";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { ThreadComment, ThreadCtx } from "@/components/ThreadTree";
import { formatDistanceToNow } from "date-fns";
import { UserLink } from "@/components/UserAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InlineCommentThreadProps {
  /** Existing inline comment events to display */
  comments: NostrEvent[];
  /** The root PR or patch event — needed for publishing new comments */
  rootEvent: NostrEvent;
  /** The immediate parent event (same as rootEvent for top-level) */
  parentEvent?: NostrEvent;
  /** Code location for new comments */
  commentOptions: InlineCommentOptions;
  /** Called when the user dismisses the thread (e.g. clicks outside) */
  onClose?: () => void;
  /** When true, show the composer immediately (e.g. user just clicked a line) */
  autoFocus?: boolean;
  /**
   * Whether this thread has been resolved.
   * Derived from InlineCommentMap.resolvedThreadIds for the first comment's ID.
   */
  isResolved?: boolean;
  /**
   * The resolution event (kind:1111 with `["l", "resolved"]`) for this thread.
   * When provided, a compact resolved footer is shown at the bottom of the panel.
   */
  resolveEvent?: NostrEvent;
  /**
   * Pubkeys authorized to resolve this thread (maintainers + PR/patch author).
   * When provided and the current user is in this set, a "Resolve" button is shown.
   */
  authorizedPubkeys?: Set<string>;
  /** Repo coordinates for relay group keying on the resolve event */
  repoCoords?: string[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Inline composer
// ---------------------------------------------------------------------------

interface InlineComposerProps {
  rootEvent: NostrEvent;
  parentEvent: NostrEvent;
  commentOptions: InlineCommentOptions;
  onSubmitted: () => void;
  onCancel: () => void;
  autoFocus?: boolean;
  /**
   * When set, this is a reply to an existing comment — publish a plain
   * NIP-22 kind:1111 comment with this event as the parent instead of
   * a special inline code comment.
   */
  replyToComment?: NostrEvent;
}

function InlineComposer({
  rootEvent,
  parentEvent,
  commentOptions,
  onSubmitted,
  onCancel,
  autoFocus,
  replyToComment,
}: InlineComposerProps) {
  const composerRef = useRef<NostrComposerHandle>(null);
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const { openAuthModal } = useAuthModal();

  const account = useActiveAccount();
  const profile = useProfile(account?.pubkey);
  const { name: displayName } = useUserDisplayName(account?.pubkey ?? "");
  const initials = displayName.slice(0, 2).toUpperCase() || "?";

  const showToggle = hasPreviewableContent(body);

  const submitComment = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsPending(true);
    try {
      if (replyToComment) {
        // Reply to an existing comment — plain NIP-22 kind:1111, no code location tags
        await runner.run(CreateComment, replyToComment, trimmed, rootEvent);
      } else {
        // New inline code comment — includes file/line/commit location tags
        await runner.run(
          CreateInlineComment,
          rootEvent,
          parentEvent,
          trimmed,
          commentOptions,
        );
      }
      toast({ title: "Comment posted" });
      setBody("");
      setActiveTab("write");
      onSubmitted();
    } catch (err) {
      toast({
        title: "Failed to post comment",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }, [
    body,
    rootEvent,
    parentEvent,
    commentOptions,
    replyToComment,
    onSubmitted,
    toast,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!account) {
        openAuthModal("landing", () => void submitComment());
        return;
      }
      await submitComment();
    },
    [account, openAuthModal, submitComment],
  );

  return (
    <div className="p-3 border-t border-border/40 bg-muted/20">
      <div className="flex gap-2 items-start">
        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
          {profile?.picture && (
            <AvatarImage src={profile.picture} alt={displayName} />
          )}
          <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-pink-500/20 text-foreground font-medium text-[10px]">
            {initials}
          </AvatarFallback>
        </Avatar>

        <form onSubmit={handleSubmit} className="flex-1 space-y-2">
          <NostrComposer
            ref={composerRef}
            value={body}
            onChange={setBody}
            placeholder="Leave a comment..."
            rows={3}
            minRows={3}
            maxHeight="40vh"
            activeTab={activeTab}
            onTabChange={setActiveTab}
            disabled={isPending}
            autoFocus={autoFocus}
          />

          <div className="flex items-center gap-2">
            {/* Write / Preview toggle — only when there's previewable content */}
            {showToggle && (
              <div className="flex items-center gap-0.5">
                {(["write", "preview"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                      activeTab === tab
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={isPending}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !body.trim() || composerHasNsec(body)}
                className="h-7 text-xs bg-pink-600 hover:bg-pink-700 text-white"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Posting…
                  </>
                ) : (
                  "Comment"
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolved footer — compact "marked as resolved" row for the diff panel
// ---------------------------------------------------------------------------

function ResolvedFooter({
  resolveEvent,
  authorizedPubkeys,
  repoCoords,
}: {
  resolveEvent: NostrEvent;
  authorizedPubkeys?: Set<string>;
  repoCoords?: string[];
}) {
  const activeAccount = useActiveAccount();
  const isOwn = !!activeAccount && activeAccount.pubkey === resolveEvent.pubkey;

  const authorised =
    authorizedPubkeys === undefined ||
    authorizedPubkeys.size === 0 ||
    authorizedPubkeys.has(resolveEvent.pubkey);

  const timeAgo = formatDistanceToNow(
    new Date(resolveEvent.created_at * 1000),
    { addSuffix: true },
  );

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const reasonId = `delete-resolve-${resolveEvent.id.slice(0, 8)}-reason`;

  const confirmDelete = useCallback(async () => {
    if (deleting || !repoCoords) return;
    setDeleting(true);
    try {
      await runner.run(
        DeleteEvent,
        [resolveEvent],
        repoCoords,
        deleteReason.trim() || undefined,
      );
    } catch (err) {
      console.error("[ResolvedFooter] failed to delete:", err);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteReason("");
    }
  }, [deleting, resolveEvent, repoCoords, deleteReason]);

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/40 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 text-green-500/70 shrink-0" />
        <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
          <UserLink
            pubkey={resolveEvent.pubkey}
            avatarSize="sm"
            nameClassName="text-xs font-medium text-foreground/80"
          />
          <span className="text-green-600/80 dark:text-green-400/80 shrink-0">
            {authorised ? "marked as resolved" : "proposed resolving"}
          </span>
          {!authorised && (
            <span className="text-muted-foreground/50 shrink-0">
              (not a maintainer)
            </span>
          )}
          <span className="text-muted-foreground/50 shrink-0">{timeAgo}</span>
        </div>

        {/* Delete — only for own events */}
        {isOwn && repoCoords && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="text-muted-foreground/40 hover:text-destructive transition-colors px-1 py-0.5 rounded"
            aria-label="Delete resolution"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => !v && setDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this resolution?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a deletion request (NIP-09). Not all relays honour
              deletion requests — the event may remain visible on some clients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor={reasonId} className="text-sm">
              Reason{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id={reasonId}
              placeholder="Why are you deleting this resolution?"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteOpen(false);
                setDeleteReason("");
              }}
              disabled={deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Sending…" : "Send deletion request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InlineCommentThread({
  comments,
  rootEvent,
  parentEvent,
  commentOptions,
  onClose,
  autoFocus = false,
  isResolved = false,
  resolveEvent,
  authorizedPubkeys,
  repoCoords,
  className,
}: InlineCommentThreadProps) {
  const [composerOpen, setComposerOpen] = useState(autoFocus);
  /**
   * Whether the thread body (comments + composer) is collapsed.
   * Resolved threads start collapsed; unresolved threads start expanded.
   */
  const [collapsed, setCollapsed] = useState(isResolved);
  const [resolving, setResolving] = useState(false);
  /**
   * When the "Reply" button is clicked on an existing thread, this is set to
   * the last comment in the thread so the reply is a plain NIP-22 comment
   * (no code location tags) with that comment as the parent.
   * When null, the composer is for a brand-new inline code comment.
   */
  const [replyToComment, setReplyToComment] = useState<NostrEvent | null>(null);
  /**
   * Incremented each time we want to force-remount the InlineComposer so that
   * autoFocus fires again (e.g. when switching which comment we're replying to
   * while the composer is already open).
   */
  const [composerKey, setComposerKey] = useState(0);
  const effectiveParent = parentEvent ?? rootEvent;
  const { toast } = useToast();
  const activeAccount = useActiveAccount();

  // Split comments into root inline comments (have "f" tag) and plain replies.
  // The thread root is always the first inline comment.
  const { rootComments, replyComments } = useMemo(() => {
    const roots = comments.filter(isInlineComment);
    const replies = comments.filter((e) => !isInlineComment(e));
    return { rootComments: roots, replyComments: replies };
  }, [comments]);

  // ThreadContext passed to ThreadCtx.Provider so ThreadComment gets
  // repoCoords, delete support, etc. canReply=false disables the ReplyBox
  // inside ThreadComment — the diff view has its own reply UI at the bottom.
  // onReply wires the per-comment Reply button to the diff view's composer.
  // hideInlineCommentBanner suppresses the file/line banner since we're
  // already embedded inside the diff view where location is obvious.
  const handleReplyFromComment = useCallback((commentEvent: NostrEvent) => {
    setReplyToComment(commentEvent);
    setComposerOpen(true);
    setCollapsed(false);
    // Remount the composer so autoFocus fires even if it was already open
    // (e.g. switching which comment to reply to).
    setComposerKey((k) => k + 1);
  }, []);

  const threadCtxValue = useMemo(
    () => ({
      rootEvent,
      repoCoords,
      canReply: false as const,
      hideInlineCommentBanner: true,
      onReply: handleReplyFromComment,
    }),
    [rootEvent, repoCoords, handleReplyFromComment],
  );

  // The thread root is the first inline comment — used as the parent for the resolve event.
  const threadRootComment = rootComments.length > 0 ? rootComments[0] : null;

  // Can the current user resolve this thread?
  const canResolve =
    !isResolved &&
    !!activeAccount &&
    !!authorizedPubkeys &&
    authorizedPubkeys.has(activeAccount.pubkey) &&
    !!threadRootComment;

  // When autoFocus transitions to true (e.g. user clicks "+" on a line that
  // already has comments and the thread is already mounted), open the composer
  // as a new inline code comment (not a reply) and expand if collapsed.
  useEffect(() => {
    if (autoFocus) {
      setReplyToComment(null);
      setComposerOpen(true);
      setCollapsed(false);
    }
  }, [autoFocus]);

  // When isResolved changes (e.g. resolution event arrives from relay),
  // collapse the thread automatically.
  useEffect(() => {
    if (isResolved) setCollapsed(true);
  }, [isResolved]);

  const handleSubmitted = useCallback(() => {
    setComposerOpen(false);
    setReplyToComment(null);
  }, []);

  const handleCancel = useCallback(() => {
    setComposerOpen(false);
    setReplyToComment(null);
    if (comments.length === 0) {
      onClose?.();
    }
  }, [comments.length, onClose]);

  const handleResolve = useCallback(async () => {
    if (!threadRootComment || resolving) return;
    setResolving(true);
    try {
      await runner.run(ResolveThread, rootEvent, threadRootComment, repoCoords);
      toast({ title: "Thread resolved" });
    } catch (err) {
      toast({
        title: "Failed to resolve thread",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  }, [threadRootComment, resolving, rootEvent, repoCoords, toast]);

  if (comments.length === 0 && !composerOpen && !autoFocus) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-b-md border border-t-0 bg-background shadow-sm font-sans",
        isResolved ? "border-green-500/30" : "border-blue-500/30",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 border-b rounded-t-none",
          isResolved
            ? "bg-green-500/5 border-green-500/20"
            : "bg-blue-500/5 border-blue-500/20",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          aria-label={collapsed ? "Expand thread" : "Collapse thread"}
        >
          {collapsed ? (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isResolved ? "text-green-500/70" : "text-blue-500/70",
              )}
            />
          ) : (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isResolved ? "text-green-500/70" : "text-blue-500/70",
              )}
            />
          )}
          {isResolved ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500/70 shrink-0" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 text-blue-500/70 shrink-0" />
          )}
          <span className="text-xs text-muted-foreground">
            {(() => {
              // Derive the line range from the first root inline comment's tag,
              // falling back to commentOptions.line for new (unsaved) threads.
              const lineStr =
                rootComments.length > 0
                  ? (parseInlineCommentLocation(rootComments[0]).line ??
                    commentOptions.line)
                  : commentOptions.line;
              const locationLabel = lineStr
                ? ` on ${lineStr.includes("-") ? "lines" : "line"} ${lineStr}`
                : "";
              const count = comments.length;
              const resolvedLabel = isResolved ? " · resolved" : "";
              return count > 0
                ? `${count} comment${count !== 1 ? "s" : ""}${locationLabel}${resolvedLabel}`
                : `New comment${locationLabel}`;
            })()}
          </span>
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            aria-label="Close thread"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Thread body — hidden when collapsed */}
      {!collapsed && (
        <ThreadCtx.Provider value={threadCtxValue}>
          {/* Root inline comments (have "f" tag) */}
          {rootComments.map((comment) => (
            <ThreadComment key={comment.id} event={comment} />
          ))}

          {/* Replies (plain NIP-22, no "f" tag) — nested with blue left border */}
          {replyComments.length > 0 && (
            <div
              className="ml-3 border-l pl-2"
              style={{ borderLeftColor: "rgb(59 130 246 / 0.4)" }}
            >
              {replyComments.map((reply) => (
                <ThreadComment key={reply.id} event={reply} />
              ))}
            </div>
          )}

          {/* Footer: resolved indicator, composer, or reply/resolve actions */}
          {isResolved && resolveEvent ? (
            <ResolvedFooter
              resolveEvent={resolveEvent}
              authorizedPubkeys={authorizedPubkeys}
              repoCoords={repoCoords}
            />
          ) : composerOpen ? (
            <InlineComposer
              key={composerKey}
              rootEvent={rootEvent}
              parentEvent={effectiveParent}
              commentOptions={commentOptions}
              onSubmitted={handleSubmitted}
              onCancel={handleCancel}
              autoFocus={composerKey > 0 || autoFocus}
              replyToComment={replyToComment ?? undefined}
            />
          ) : (
            <div className="px-3 py-2 border-t border-border/40 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  // Reply to the last comment in the thread (plain NIP-22, no code tags)
                  const lastComment =
                    comments.length > 0 ? comments[comments.length - 1] : null;
                  setReplyToComment(lastComment);
                  setComposerOpen(true);
                  setComposerKey((k) => k + 1);
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Reply className="h-3.5 w-3.5" />
                Reply
              </button>
              {canResolve && (
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={resolving}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors ml-auto disabled:opacity-50"
                >
                  {resolving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Resolve
                </button>
              )}
            </div>
          )}
        </ThreadCtx.Provider>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact comment count badge — shown on diff lines that have comments
// ---------------------------------------------------------------------------

export function InlineCommentBadge({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
        "text-[10px] font-medium leading-none",
        "bg-blue-500/15 text-blue-600 dark:text-blue-400",
        "hover:bg-blue-500/25 transition-colors",
        className,
      )}
      title={`${count} comment${count !== 1 ? "s" : ""}`}
    >
      <MessageSquare className="h-2.5 w-2.5" />
      {count}
    </button>
  );
}
