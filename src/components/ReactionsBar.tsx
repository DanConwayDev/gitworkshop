/**
 * ReactionsBar — NIP-25 (kind:7) reactions for NIP-34 thread events.
 *
 * Uses:
 *   - ReactionsModel (applesauce-common/models) to subscribe to reactions from
 *     the EventStore reactively
 *   - Reaction cast (applesauce-common/casts) for typed access to emoji content
 *   - ReactionBlueprint (applesauce-common/blueprints) via the CreateReaction
 *     action in src/actions/nip34.ts for publishing with the correct outbox
 *     relay strategy
 *
 * UI mirrors gitworkshop's EventWrapper.svelte reaction section:
 *   - Collapsed view: grouped emoji pills with counts, plus a faint "add
 *     reaction" heart button
 *   - Expanded picker: preset emoji buttons + close button
 *   - Pill hover: tooltip showing who reacted
 *   - Own reaction: highlighted pill; clicking it opens a delete confirmation
 */

import { useState, useCallback, useMemo } from "react";
import type { NostrEvent } from "nostr-tools";
import { Reaction } from "applesauce-common/casts";
import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { ReactionsModel } from "applesauce-common/models";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { useActiveAccount } from "applesauce-react/hooks";
import { CreateReaction } from "@/actions/nip34";
import { runner } from "@/services/actions";
import { UserLink } from "@/components/UserAvatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";
import { Heart, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Preset emojis (matching gitworkshop)
// ---------------------------------------------------------------------------

const PRESET_EMOJIS = ["+", "🚀", "🤙", "🙏", "❤️", "🫂", "👀", "😂"];

// ---------------------------------------------------------------------------
// ReactionsBar
// ---------------------------------------------------------------------------

interface ReactionsBarProps {
  event: NostrEvent;
  repoRelays: string[];
  repoCoords?: string[];
  className?: string;
}

export function ReactionsBar({
  event,
  repoRelays,
  repoCoords,
  className,
}: ReactionsBarProps) {
  const store = useEventStore();
  const castStore = store as unknown as CastRefEventStore;
  const activeAccount = useActiveAccount();

  // Subscribe to reactions from the EventStore via ReactionsModel
  const reactionEvents = use$(
    () => store.model(ReactionsModel, event),
    [event, store],
  );

  // Cast raw events to Reaction instances, silently dropping invalid ones
  const reactions = useMemo<Reaction[]>(() => {
    if (!reactionEvents) return [];
    const result: Reaction[] = [];
    for (const ev of reactionEvents) {
      try {
        result.push(new Reaction(ev, castStore));
      } catch {
        // invalid reaction event — skip
      }
    }
    return result;
  }, [reactionEvents, castStore]);

  // Group reactions by emoji content → Set of pubkeys
  const grouped = useMemo(() => {
    return reactions.reduce<Map<string, Set<string>>>((acc, r) => {
      const emoji = r.content;
      if (!acc.has(emoji)) acc.set(emoji, new Set());
      acc.get(emoji)!.add(r.event.pubkey);
      return acc;
    }, new Map());
  }, [reactions]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NostrEvent | null>(null);

  const myPubkey = activeAccount?.pubkey;

  const sendReaction = useCallback(
    async (emoji: string) => {
      if (sending || !activeAccount) return;
      setSending(true);
      try {
        await runner.run(CreateReaction, event, emoji, repoRelays, repoCoords);
      } catch (err) {
        console.error("[ReactionsBar] failed to send reaction:", err);
      } finally {
        setSending(false);
        setPickerOpen(false);
      }
    },
    [sending, activeAccount, event, repoRelays, repoCoords],
  );

  // Find the current user's reaction event for a given emoji (for deletion)
  const myReactionEvent = useCallback(
    (emoji: string): NostrEvent | undefined => {
      if (!myPubkey) return undefined;
      return reactions.find(
        (r) => r.event.pubkey === myPubkey && r.content === emoji,
      )?.event;
    },
    [reactions, myPubkey],
  );

  if (grouped.size === 0 && !activeAccount) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 pt-2", className)}>
      {/* Existing reaction groups — collapsed view */}
      {!pickerOpen &&
        Array.from(grouped.entries()).map(([emoji, pubkeys]) => {
          const iMine = myPubkey ? pubkeys.has(myPubkey) : false;
          return (
            <ReactionPill
              key={emoji}
              emoji={emoji}
              pubkeys={pubkeys}
              isMine={iMine}
              disabled={sending}
              onClick={() => setPickerOpen(true)}
            />
          );
        })}

      {/* Add reaction / picker toggle — only shown when logged in */}
      {activeAccount && (
        <>
          {!pickerOpen ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={sending}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border/40 px-2 py-0.5",
                "text-xs text-muted-foreground/50 hover:text-muted-foreground hover:border-border/70",
                "transition-colors disabled:opacity-40",
                grouped.size === 0 && "-ml-0.5",
              )}
              aria-label="Add reaction"
            >
              <Heart className="h-3 w-3" />
            </button>
          ) : (
            <div className="flex flex-col gap-2 w-full">
              {/* Row 1: existing reactions with who reacted */}
              {grouped.size > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from(grouped.entries()).map(([emoji, pubkeys]) => {
                    const iMine = myPubkey ? pubkeys.has(myPubkey) : false;
                    return (
                      <ReactionGroup
                        key={emoji}
                        emoji={emoji}
                        pubkeys={pubkeys}
                        isMine={iMine}
                        disabled={sending}
                        onClickMine={() => {
                          const ev = myReactionEvent(emoji);
                          if (ev) setDeleteTarget(ev);
                        }}
                        onClickOther={() => sendReaction(emoji)}
                      />
                    );
                  })}
                </div>
              )}
              {/* Row 2: unused preset emojis to pick from + close */}
              <div className="flex flex-wrap items-center gap-1">
                {PRESET_EMOJIS.filter((emoji) => !grouped.has(emoji)).map(
                  (emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      disabled={sending}
                      onClick={() => sendReaction(emoji)}
                      className={cn(
                        "rounded border border-border/40 px-1.5 py-0.5 text-sm",
                        "hover:bg-muted/60 transition-colors disabled:opacity-40 text-foreground",
                      )}
                    >
                      {emoji === "+" ? "👍" : emoji}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded border border-border/30 p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  aria-label="Close reaction picker"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      <DeleteReactionDialog
        open={!!deleteTarget}
        onConfirm={() => {
          // TODO: wire up DeleteEvent action when available
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReactionPill — collapsed emoji pill (clicking opens the expanded view)
// ---------------------------------------------------------------------------

function ReactionPill({
  emoji,
  pubkeys,
  isMine,
  disabled,
  onClick,
}: {
  emoji: string;
  pubkeys: Set<string>;
  isMine: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const display = emoji === "+" ? "👍" : emoji;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        "transition-colors disabled:opacity-40",
        isMine
          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
          : "border-border/40 bg-muted/30 text-foreground hover:bg-muted/60",
      )}
    >
      <span>{display}</span>
      <span className="text-muted-foreground">{pubkeys.size}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ReactionGroup — expanded view: emoji button + list of who reacted
// ---------------------------------------------------------------------------

function ReactionGroup({
  emoji,
  pubkeys,
  isMine,
  disabled,
  onClickMine,
  onClickOther,
}: {
  emoji: string;
  pubkeys: Set<string>;
  isMine: boolean;
  disabled: boolean;
  onClickMine: () => void;
  onClickOther: () => void;
}) {
  const display = emoji === "+" ? "👍" : emoji;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border overflow-hidden",
        isMine ? "border-primary/50" : "border-border/40",
      )}
    >
      {/* Emoji button — add or remove own reaction */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={isMine ? onClickMine : onClickOther}
            className={cn(
              "px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-40",
              isMine
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "bg-muted text-foreground hover:bg-muted/70",
            )}
            aria-label={
              isMine ? `Remove ${display} reaction` : `React with ${display}`
            }
          >
            {display}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isMine ? "Remove reaction" : "Add reaction"}
        </TooltipContent>
      </Tooltip>

      {/* Who reacted — visually recessed so the emoji button stands out */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-background/60">
        {Array.from(pubkeys).map((pk) => (
          <UserLink
            key={pk}
            pubkey={pk}
            avatarSize="sm"
            nameClassName="text-xs"
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteReactionDialog
// ---------------------------------------------------------------------------

function DeleteReactionDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove reaction?</AlertDialogTitle>
          <AlertDialogDescription>
            This will send a deletion request. Not all relays honour deletion
            requests.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Send deletion request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
