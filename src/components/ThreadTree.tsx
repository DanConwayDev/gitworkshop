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
import {
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

  // The node body: the event itself (unless isRoot) + non-resolution children.
  // This is what gets wrapped inside ResolvedThreadCard when resolved.
  const nodeBody = (
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
            <ThreadComment event={node.event} />
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
        {nodeBody}
      </ResolvedThreadCard>
    </div>
  ) : (
    <div>{nodeBody}</div>
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
 * Lightweight comment renderer without a Card wrapper. The thread's left
 * border line provides the visual container; each comment is separated by
 * a subtle top border.
 */
export function ThreadComment({ event }: { event: NostrEvent }) {
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

  // Detect inline comment and extract location for the context banner
  const isInline = isInlineComment(event);
  const inlineLoc = isInline ? parseInlineCommentLocation(event) : null;

  // Build a permalink to the Files Changed / commit diff view for this inline comment.
  const inlinePermalink = (() => {
    if (!ctx?.prBasePath || !inlineLoc?.filePath) return null;
    // Build the hash fragment: anchor to the specific line if we have one.
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

    // Prefer the commit-specific view when a commitId is available.
    if (inlineLoc.commitId) {
      return `${ctx.prBasePath}/commit/${inlineLoc.commitId}${hash}`;
    }
    return `${ctx.prBasePath}/files${hash}`;
  })();

  // Diff snippet — fetched lazily when the banner enters the viewport
  const [snippet, setSnippet] = useState<string[] | null | "loading">(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !isInline ||
      !inlineLoc?.filePath ||
      !inlineLoc.lineRange ||
      !ctx?.getDiffSnippet
    )
      return;
    if (snippet !== null) return; // already fetched or loading

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
          .then((lines) => {
            setSnippet(lines ?? null);
          })
          .catch(() => {
            setSnippet(null);
          });
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

  return (
    <div
      id={anchorId}
      ref={elRef}
      className={`min-w-0 overflow-hidden border-t border-border/40 p-3 scroll-mt-20 transition-colors duration-700 ${
        effectiveHighlight === "strong"
          ? "bg-pink-500/10"
          : effectiveHighlight === "subtle"
            ? "bg-pink-500/5"
            : ""
      }`}
    >
      {/* Inline comment context banner — hidden when already inside the diff view */}
      {isInline && inlineLoc?.filePath && !ctx?.hideInlineCommentBanner && (
        <div
          ref={bannerRef}
          className="mb-2 rounded border border-border/40 bg-muted/40 overflow-hidden text-xs font-mono"
        >
          {/* File path header row */}
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
          {Array.isArray(snippet) && snippet.length > 0 && (
            <div>
              {snippet.map((line, i) => {
                const prefix = line[0];
                const content = line.slice(1);
                const bg =
                  prefix === "+"
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : prefix === "-"
                      ? "bg-red-500/10 text-red-700 dark:text-red-400"
                      : "text-muted-foreground";
                return (
                  <div
                    key={i}
                    className={`flex gap-2 px-2 py-0.5 leading-5 min-h-[1.25rem] ${bg}`}
                  >
                    <span className="select-none w-3 shrink-0 opacity-60">
                      {prefix}
                    </span>
                    <span className="whitespace-pre-wrap break-all">
                      {content}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
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
