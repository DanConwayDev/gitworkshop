/**
 * Recursive thread tree renderer.
 *
 * Takes a ThreadTreeNode (from src/lib/threadTree.ts) and renders it as a
 * nested, collapsible thread — similar to gitworkshop.dev's ThreadTree.svelte.
 *
 * The data structure is decoupled from the UI: the tree is built by pure
 * functions in threadTree.ts, and this component only handles rendering.
 * Swapping to a different layout (flat, side-by-side, etc.) only requires
 * changing this file.
 *
 * Visual approach: the thread's left border line IS the container — individual
 * comments don't get their own Card border. Each comment is separated by a
 * subtle top border. This keeps deep threads compact (matching gitworkshop).
 */
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useUnreadHighlight } from "@/hooks/useUnreadHighlight";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Calendar,
  Reply,
  Trash2,
  FileCode,
} from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import type { ThreadTreeNode } from "@/lib/threadTree";
import { countDescendants } from "@/lib/threadTree";
import { UserLink } from "@/components/UserAvatar";
import { EventCardActions } from "@/components/EventCardActions";
import { CommentContent } from "@/components/CommentContent";
import { ReplyBox } from "@/components/ReplyBox";
import type { ThreadContext } from "@/components/EventThreadComponents";
import { OutboxStatusBadge } from "@/components/OutboxStatusStrip";
import { ReactionsBar } from "@/components/ReactionsBar";
import { useActiveAccount } from "applesauce-react/hooks";
import { DeleteEvent } from "@/actions/nip34";
import { runner } from "@/services/actions";
import {
  isInlineComment,
  parseInlineCommentLocation,
} from "@/blueprints/inline-comment";
import { diffLineHash, fileDiffCardId } from "@/lib/diffCardId";
import { Link } from "react-router-dom";
import type { SnippetLine } from "@/pages/PRPage";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Thread context — passes root info down without prop-drilling
// ---------------------------------------------------------------------------

// Re-exported for consumers that import ThreadCtx from this module.
export { ThreadCtx } from "@/contexts/ThreadContext";
import { ThreadCtx } from "@/contexts/ThreadContext";
import { isResolutionEvent } from "@/hooks/useInlineComments";
import { ResolvedThreadCard } from "@/components/EventThreadComponents";

// ---------------------------------------------------------------------------
// Depth-based color palette
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThreadTreeProps {
  /** The tree node to render (and its descendants). */
  node: ThreadTreeNode;
  /**
   * Whether this is the root node of the thread (the issue/PR body itself).
   * When true, the node's own event is NOT rendered — only its children.
   * The caller is expected to render the root event separately (e.g. as an
   * EventBodyCard).
   */
  isRoot?: boolean;
  /**
   * Custom renderer for a single event node. Defaults to the built-in
   * borderless ThreadComment. This allows the caller to render different
   * event kinds differently (e.g. reactions, status changes) without
   * modifying this component.
   */
  renderEvent?: (event: NostrEvent, node: ThreadTreeNode) => React.ReactNode;
  /**
   * Filter predicate for child nodes. Return false to exclude a child
   * from rendering (e.g. to filter out kind:7 reactions that are shown
   * inline on the parent). Defaults to including all children.
   */
  filterChildren?: (node: ThreadTreeNode) => boolean;
  /**
   * Current nesting depth. Used to fade the left border line — deeper
   * threads get a more subtle line. Clamped so it never disappears entirely.
   */
  depth?: number;
  /**
   * Root context for inline reply composers. Required at the top level;
   * propagated automatically to nested nodes via context.
   */
  threadContext?: ThreadContext;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadTree({
  node,
  isRoot = false,
  renderEvent,
  filterChildren,
  depth = 0,
  threadContext,
}: ThreadTreeProps) {
  const ctx = useContext(ThreadCtx);
  const effectiveCtx = threadContext ?? ctx;

  const visibleChildren = filterChildren
    ? node.children.filter(filterChildren)
    : node.children;

  // Detect whether any direct child is a resolution event.
  // When found, the resolution event is rendered as a ResolvedThreadCard that
  // wraps the node body (event + non-resolution children) as collapsible content.
  const resolutionChild = visibleChildren.find((c) =>
    isResolutionEvent(c.event),
  );
  const nonResolutionChildren = resolutionChild
    ? visibleChildren.filter((c) => !isResolutionEvent(c.event))
    : visibleChildren;

  const authorised =
    !!resolutionChild &&
    (effectiveCtx?.authorizedPubkeys === undefined ||
      effectiveCtx.authorizedPubkeys.size === 0 ||
      effectiveCtx.authorizedPubkeys.has(resolutionChild.event.pubkey));

  // Detect whether this node's own event is an inline comment so we can wrap
  // the comment + its children in the blue left-border indentation block.
  const nodeIsInline = !isRoot && isInlineComment(node.event);

  // The node body: the event itself (unless isRoot) + non-resolution children.
  // This is what gets wrapped inside ResolvedThreadCard when resolved.
  const commentAndChildren = (
    <>
      {!isRoot && (
        <>
          {node.missingParent && (
            <div className="flex items-center gap-1.5 text-xs text-destructive/70 py-1 px-2 border-y border-destructive/20 bg-destructive/5">
              <AlertTriangle className="h-3 w-3" />
              <span>missing parent note</span>
            </div>
          )}
          {renderEvent ? (
            renderEvent(node.event, node)
          ) : (
            <ThreadComment event={node.event} hideBanner={nodeIsInline} />
          )}
        </>
      )}
      {nonResolutionChildren.length > 0 && (
        <ThreadChildren
          nodes={nonResolutionChildren}
          renderEvent={renderEvent}
          filterChildren={filterChildren}
          isMissingParentContext={node.missingParent}
          depth={depth + 1}
        />
      )}
    </>
  );

  const inner = resolutionChild ? (
    // Wrap the resolved thread in the same blue left border used by the outer
    // conversation timeline so the expanded content reads as part of the thread.
    // The border already provides the visual grouping for inline comments here.
    <div
      className="min-w-0 border-l pl-1"
      style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
    >
      <ResolvedThreadCard
        event={resolutionChild.event}
        rootCommentEvent={node.event}
        authorised={authorised}
        repoCoords={effectiveCtx?.repoCoords}
      >
        {commentAndChildren}
      </ResolvedThreadCard>
    </div>
  ) : nodeIsInline ? (
    // Inline comment: banner always visible above, then a collapsible border-l
    // container wrapping the first comment + all replies.
    <InlineThreadWrapper banner={<InlineCommentBanner event={node.event} />}>
      {commentAndChildren}
    </InlineThreadWrapper>
  ) : (
    <div>{commentAndChildren}</div>
  );

  // Provide context at the top level; nested nodes inherit it automatically.
  if (threadContext) {
    return (
      <ThreadCtx.Provider value={threadContext}>{inner}</ThreadCtx.Provider>
    );
  }
  return inner;
}

// ---------------------------------------------------------------------------
// ThreadComment — borderless comment for use inside the thread tree
// ---------------------------------------------------------------------------

/**
 * Renders the diff snippet banner for an inline comment. Extracted so it can
 * be rendered outside the collapsible section in InlineThreadWrapper.
 */
export function InlineCommentBanner({ event }: { event: NostrEvent }) {
  const ctx = useContext(ThreadCtx);
  const isInline = isInlineComment(event);
  const inlineLoc = isInline ? parseInlineCommentLocation(event) : null;

  const inlinePermalink = (() => {
    if (!ctx?.prBasePath || !inlineLoc?.filePath) return null;
    const lineNum =
      inlineLoc.lineRange?.[1] ?? inlineLoc.lineRange?.[0] ?? null;
    const hash =
      lineNum !== null
        ? diffLineHash(
            inlineLoc.filePath,
            lineNum,
            inlineLoc.lineSide === "del" ? "del" : "new",
          )
        : "#" + fileDiffCardId(inlineLoc.filePath);
    if (inlineLoc.commitId) {
      return `${ctx.prBasePath}/commit/${inlineLoc.commitId}${hash}`;
    }
    return `${ctx.prBasePath}/files${hash}`;
  })();

  const [snippet, setSnippet] = useState<SnippetLine[] | null | "loading">(
    null,
  );
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !isInline ||
      !inlineLoc?.filePath ||
      !inlineLoc.lineRange ||
      !ctx?.getDiffSnippet
    )
      return;
    if (snippet !== null) return;

    const el = bannerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        setSnippet("loading");
        ctx.getDiffSnippet!(
          inlineLoc.filePath!,
          inlineLoc.lineRange!,
          inlineLoc.lineSide,
          inlineLoc.commitId,
        )
          .then((lines) => setSnippet(lines ?? null))
          .catch(() => setSnippet(null));
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isInline,
    inlineLoc?.filePath,
    inlineLoc?.lineRange,
    inlineLoc?.lineSide,
    inlineLoc?.commitId,
    ctx?.getDiffSnippet,
  ]);

  if (!isInline || !inlineLoc?.filePath || ctx?.hideInlineCommentBanner)
    return null;

  return (
    <div
      ref={bannerRef}
      className="rounded border border-border/40 bg-muted/40 overflow-hidden text-xs font-mono"
    >
      {/* File path header — always a link when permalink is available */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/30">
        <FileCode className="h-3 w-3 shrink-0 text-blue-500/70" />
        {inlinePermalink ? (
          <Link
            to={inlinePermalink}
            className="truncate text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
            title="View in Files Changed"
          >
            {inlineLoc.filePath}
          </Link>
        ) : (
          <span className="truncate text-muted-foreground">
            {inlineLoc.filePath}
          </span>
        )}
        {inlineLoc.line && (
          <span className="shrink-0 text-muted-foreground/50">
            :{inlineLoc.line}
          </span>
        )}
      </div>

      {/* Diff snippet — shown once fetched */}
      {snippet === "loading" && (
        <div className="px-3 py-1.5 text-muted-foreground/50 italic text-[11px]">
          Loading…
        </div>
      )}
      {Array.isArray(snippet) &&
        snippet.length > 0 &&
        (() => {
          const firstInRange = snippet.findIndex((l) => l.isInRange);
          const lastInRange = snippet.reduce(
            (acc, l, i) => (l.isInRange ? i : acc),
            -1,
          );
          const table = (
            <table className="w-full border-collapse leading-5">
              <tbody>
                {snippet.map((line, i) => {
                  const isAdd = line.prefix === "+";
                  const isDel = line.prefix === "-";
                  const isContext = !line.isInRange;
                  const isRangeStart = i === firstInRange;
                  const isRangeEnd = i === lastInRange;

                  const rowClass = isContext
                    ? isAdd
                      ? "bg-green-500/15 dark:bg-green-400/12"
                      : isDel
                        ? "bg-red-500/15 dark:bg-red-400/12"
                        : ""
                    : "";

                  const borderTop = isRangeStart
                    ? "1px solid rgb(59 130 246 / 0.55)"
                    : undefined;
                  const borderBottom = isRangeEnd
                    ? "1px solid rgb(59 130 246 / 0.55)"
                    : undefined;

                  const gutterBg = line.isInRange
                    ? isAdd
                      ? "linear-gradient(rgba(34,197,94,0.28),rgba(34,197,94,0.28)), linear-gradient(rgba(59,130,246,0.14),rgba(59,130,246,0.14)), linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))"
                      : isDel
                        ? "linear-gradient(rgba(239,68,68,0.28),rgba(239,68,68,0.28)), linear-gradient(rgba(59,130,246,0.14),rgba(59,130,246,0.14)), linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))"
                        : "linear-gradient(rgba(59,130,246,0.14),rgba(59,130,246,0.14)), linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))"
                    : isAdd
                      ? "linear-gradient(rgba(34,197,94,0.28),rgba(34,197,94,0.28)), linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))"
                      : isDel
                        ? "linear-gradient(rgba(239,68,68,0.28),rgba(239,68,68,0.28)), linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))"
                        : "linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))";

                  const lineNumColor = line.isInRange
                    ? "text-blue-600/70 dark:text-blue-400/70"
                    : isAdd
                      ? "text-green-700/70 dark:text-green-400/70"
                      : isDel
                        ? "text-red-700/70 dark:text-red-400/70"
                        : "text-muted-foreground/60";

                  const textColor = isAdd
                    ? "text-green-700 dark:text-green-400"
                    : isDel
                      ? "text-red-700 dark:text-red-400"
                      : "text-muted-foreground";

                  const contextFilter: React.CSSProperties = isContext
                    ? { filter: "blur(0.8px)", opacity: 0.45 }
                    : {};

                  return (
                    <tr key={i} className={rowClass}>
                      <td
                        className={`select-none text-right px-2 w-8 shrink-0 border-r border-border/30 bg-background ${lineNumColor}`}
                        style={{
                          backgroundImage: gutterBg,
                          borderLeft: line.isInRange
                            ? "2px solid rgb(59 130 246 / 0.65)"
                            : undefined,
                          borderTop,
                          borderBottom,
                          ...contextFilter,
                        }}
                      >
                        {line.lineNum}
                      </td>
                      <td
                        className={`select-none text-center w-4 shrink-0 border-l border-border/30 ${textColor}`}
                        style={{
                          borderTop,
                          borderBottom,
                          backgroundColor: line.isInRange
                            ? "rgb(59 130 246 / 0.10)"
                            : undefined,
                          ...contextFilter,
                        }}
                      >
                        {line.prefix === " " ? "" : line.prefix}
                      </td>
                      <td
                        className={`pl-1 pr-2 whitespace-pre-wrap break-all ${textColor}`}
                        style={{
                          borderTop,
                          borderBottom,
                          backgroundColor: line.isInRange
                            ? "rgb(59 130 246 / 0.10)"
                            : undefined,
                          ...contextFilter,
                        }}
                      >
                        {line.content}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
          return inlinePermalink ? (
            <Link
              to={inlinePermalink}
              className="block hover:bg-muted/60 transition-colors"
              title="View in Files Changed"
              tabIndex={-1}
            >
              {table}
            </Link>
          ) : (
            table
          );
        })()}
    </div>
  );
}

/**
 * Lightweight comment renderer without a Card wrapper. The thread's left
 * border line provides the visual container; each comment is separated by
 * a subtle top border.
 */
export function ThreadComment({
  event,
  hideBanner = false,
}: {
  event: NostrEvent;
  hideBanner?: boolean;
}) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  const anchorId = event.id.slice(0, 15);
  const { ref, highlight: effectiveHighlight } = useUnreadHighlight(anchorId);
  const elRef = ref as RefObject<HTMLDivElement>;

  const [replying, setReplying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const ctx = useContext(ThreadCtx);
  // canReply defaults to true when ctx is present (backward compat), but can
  // be explicitly disabled via ctx.canReply = false (e.g. for logged-out users
  // where we still want the context for inline comment links).
  const canReply = !!ctx && ctx.canReply !== false;
  // onReply callback: when provided by the context, show a Reply button in the
  // header even if canReply is false (e.g. diff view uses its own reply UI).
  const onReplyCallback = ctx?.onReply;
  const activeAccount = useActiveAccount();
  const isOwn = !!activeAccount && activeAccount.pubkey === event.pubkey;

  const confirmDelete = useCallback(async () => {
    if (deleting || !ctx) return;
    setDeleting(true);
    try {
      await runner.run(
        DeleteEvent,
        [event],
        ctx.repoCoords,
        deleteReason.trim() || undefined,
      );
    } catch (err) {
      console.error("[ThreadComment] failed to delete comment:", err);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteReason("");
    }
  }, [deleting, ctx, event, deleteReason]);

  const isInline = isInlineComment(event);

  return (
    <div
      id={anchorId}
      ref={elRef}
      className={`min-w-0 overflow-hidden p-3 scroll-mt-20 transition-colors duration-700 ${
        isInline ? "" : "border-t border-border/40"
      } ${
        effectiveHighlight === "strong"
          ? "bg-pink-500/10"
          : effectiveHighlight === "subtle"
            ? "bg-pink-500/5"
            : ""
      }`}
    >
      {/* Banner rendered here only when not hoisted outside the collapsible */}
      {!hideBanner && (
        <div className="mb-2">
          <InlineCommentBanner event={event} />
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="md"
            nameClassName="text-sm"
          />
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {timeAgo}
            </span>
            <OutboxStatusBadge event={event} />
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(canReply || onReplyCallback) && (
            <button
              type="button"
              onClick={() => {
                if (onReplyCallback) {
                  onReplyCallback(event);
                } else {
                  setReplying((r) => !r);
                }
              }}
              className="flex items-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1.5 py-0.5 rounded"
              aria-label="Reply to comment"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
          )}
          {isOwn && ctx && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="flex items-center text-xs text-muted-foreground/60 hover:text-destructive transition-colors px-1.5 py-0.5 rounded"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <EventCardActions event={event} />
        </div>
      </div>
      {/* Body: on small screens equal padding; on sm+ align under username text.
          UserLink uses w-8 avatar + gap-1.5 = 38px before the name text. */}
      <div className="sm:ml-[38px]">
        <CommentContent content={event.content} />
        {ctx && <ReactionsBar event={event} repoCoords={ctx.repoCoords} />}
      </div>

      {/* Inline reply composer */}
      {replying && ctx && (
        <div className="mt-3 sm:ml-[38px]">
          <ReplyBox
            rootEvent={ctx.rootEvent}
            parentEvent={event}
            onSubmitted={() => setReplying(false)}
            priorityPubkeys={ctx.priorityPubkeys}
          />
        </div>
      )}

      {/* Delete comment dialog */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => !v && setDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a deletion request (NIP-09). Not all relays honour
              deletion requests — the comment may remain visible on some
              clients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="delete-comment-reason" className="text-sm">
              Reason{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="delete-comment-reason"
              placeholder="Why are you deleting this comment?"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible children wrapper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline thread wrapper — label + collapsible border-l container
// ---------------------------------------------------------------------------

/**
 * Wraps an inline comment thread (first comment + all replies) in the same
 * border-l pl-1 structure used by ThreadChildren, with a collapse toggle and
 * the "inline code comment on:" label above. This means the border runs flush
 * from the first comment through all replies with no double-border.
 */
function InlineThreadWrapper({
  banner,
  children,
}: {
  banner: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="pt-2">
      <div className="border-t border-border/40">
        <p className="text-[11px] text-muted-foreground/50 px-2 pt-2 pb-0 select-none">
          inline code comment on:
        </p>
        {/* Banner always visible — outside the collapsible */}
        <div className="px-2 pt-1 pb-0">{banner}</div>
        {/* Comments + replies are collapsible */}
        <div
          className="min-w-0 border-l pl-1"
          style={{ borderLeftColor: "rgb(59 130 246 / 0.5)" }}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="w-full text-left flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 hover:bg-muted px-2 py-1.5 transition-colors cursor-pointer"
              aria-label="Show inline thread"
            >
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              <span>show inline thread</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="flex items-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-0.5"
                aria-label="Collapse inline thread"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              {children}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadChildren({
  nodes,
  renderEvent,
  filterChildren,
  isMissingParentContext,
  depth,
}: {
  nodes: ThreadTreeNode[];
  renderEvent?: ThreadTreeProps["renderEvent"];
  filterChildren?: ThreadTreeProps["filterChildren"];
  isMissingParentContext?: boolean;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const totalDescendants = nodes.reduce(
    (sum, n) => sum + 1 + countDescendants(n),
    0,
  );

  // Fade the line as depth increases: start at 0.5 opacity, floor at 0.15.
  const lineOpacity = isMissingParentContext
    ? 0.4
    : Math.max(0.15, 0.5 - (depth - 1) * 0.1);

  return (
    <div
      className="min-w-0 border-l pl-1"
      style={{ borderLeftColor: `rgb(59 130 246 / ${lineOpacity})` }}
    >
      {/* Collapse / expand toggle */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full text-left flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 hover:bg-muted px-2 py-1.5 transition-colors cursor-pointer"
          aria-label="Expand replies"
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          <span>
            show {totalDescendants} hidden{" "}
            {totalDescendants === 1 ? "reply" : "replies"}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex items-center text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-0.5"
          aria-label="Collapse replies"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Children */}
      {!collapsed &&
        nodes.map((child) => (
          <ThreadTree
            key={child.event.id}
            node={child}
            renderEvent={renderEvent}
            filterChildren={filterChildren}
            depth={depth}
          />
        ))}
    </div>
  );
}
