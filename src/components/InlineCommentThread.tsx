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

import { useState, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import type { NostrEvent } from "nostr-tools";
import { UserLink } from "@/components/UserAvatar";
import { CommentContent } from "@/components/CommentContent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, MessageSquare, Reply, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { runner } from "@/services/actions";
import { CreateInlineComment } from "@/actions/nip34";
import type { InlineCommentOptions } from "@/blueprints/inline-comment";
import { useActiveAccount } from "applesauce-react/hooks";
import { useProfile } from "@/hooks/useProfile";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useToast } from "@/hooks/useToast";
import { useAuthModal } from "@/contexts/AuthModalContext";

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
  className?: string;
}

// ---------------------------------------------------------------------------
// Single comment row
// ---------------------------------------------------------------------------

function InlineComment({ event }: { event: NostrEvent }) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <div className="flex gap-3 p-3 border-t border-border/40 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium"
          />
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="sm:ml-[calc(1.5rem+0.375rem)]">
          <CommentContent content={event.content} className="text-sm" />
        </div>
      </div>
    </div>
  );
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
}

function InlineComposer({
  rootEvent,
  parentEvent,
  commentOptions,
  onSubmitted,
  onCancel,
  autoFocus,
}: InlineComposerProps) {
  const [body, setBody] = useState("");
  const [isPending, setIsPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { openAuthModal } = useAuthModal();

  const account = useActiveAccount();
  const profile = useProfile(account?.pubkey);
  const { name: displayName } = useUserDisplayName(account?.pubkey ?? "");
  const initials = displayName.slice(0, 2).toUpperCase() || "?";

  const submitComment = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;

    setIsPending(true);
    try {
      await runner.run(
        CreateInlineComment,
        rootEvent,
        parentEvent,
        trimmed,
        commentOptions,
      );
      toast({ title: "Comment posted" });
      setBody("");
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
  }, [body, rootEvent, parentEvent, commentOptions, onSubmitted, toast]);

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
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment..."
            rows={3}
            className="resize-none text-sm"
            disabled={isPending}
            autoFocus={autoFocus}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
              // Ctrl/Cmd+Enter to submit
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSubmit(e as unknown as React.FormEvent);
              }
            }}
          />
          <div className="flex items-center gap-2 justify-end">
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
              disabled={isPending || !body.trim()}
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
        </form>
      </div>
    </div>
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
  className,
}: InlineCommentThreadProps) {
  const [composerOpen, setComposerOpen] = useState(autoFocus);
  const effectiveParent = parentEvent ?? rootEvent;

  const handleSubmitted = useCallback(() => {
    setComposerOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    setComposerOpen(false);
    if (comments.length === 0) {
      onClose?.();
    }
  }, [comments.length, onClose]);

  if (comments.length === 0 && !composerOpen && !autoFocus) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-b-md border border-t-0 border-blue-500/30 bg-background",
        "shadow-sm",
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
      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/5 border-b border-blue-500/20 rounded-t-none">
        <MessageSquare className="h-3.5 w-3.5 text-blue-500/70 shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">
          {comments.length > 0
            ? `${comments.length} comment${comments.length !== 1 ? "s" : ""}`
            : commentOptions.line
              ? `New comment on ${commentOptions.line.includes("-") ? "lines" : "line"} ${commentOptions.line}`
              : "New comment"}
        </span>
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

      {/* Existing comments */}
      {comments.map((comment) => (
        <InlineComment key={comment.id} event={comment} />
      ))}

      {/* Composer */}
      {composerOpen ? (
        <InlineComposer
          rootEvent={rootEvent}
          parentEvent={effectiveParent}
          commentOptions={commentOptions}
          onSubmitted={handleSubmitted}
          onCancel={handleCancel}
          autoFocus={autoFocus}
        />
      ) : (
        <div className="px-3 py-2 border-t border-border/40">
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Reply className="h-3.5 w-3.5" />
            Reply
          </button>
        </div>
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
}: {
  count: number;
  onClick?: () => void;
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
      )}
      title={`${count} comment${count !== 1 ? "s" : ""}`}
    >
      <MessageSquare className="h-2.5 w-2.5" />
      {count}
    </button>
  );
}
