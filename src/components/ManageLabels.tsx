import { useState, useCallback, useRef, useEffect } from "react";
import type { NostrEvent } from "nostr-tools";
import { runner } from "@/services/actions";
import { AttachIssueLabels, DeleteEvent } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import { useActiveAccount } from "applesauce-react/hooks";
import { labelColor } from "@/components/LabelBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Normalise a raw label string: lowercase, trim, spaces→dashes. */
function normaliseLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/** The source event info for a label — the event that created it. */
export interface LabelEventEntry {
  /** The raw kind:1985 label event. */
  event: NostrEvent;
  /** All labels this event added (may be > 1). */
  eventLabels: string[];
}

interface ManageLabelsProps {
  /** Event ID of the issue or PR being labelled. */
  itemId: string;
  /** All repository coordinates from the item's `a` tags. */
  repoCoords: string[];
  /** Already-resolved labels for this item. */
  currentLabels: string[];
  /** When true the user is allowed to add labels (maintainer or item author). */
  canEdit: boolean;
  /**
   * Maps each deletable label to the label event that created it.
   * Labels absent from this map (e.g. root-event t-tags) have no delete button.
   * Only labels where the active account is the event author get a delete button.
   */
  labelEventMap?: Map<string, LabelEventEntry>;
}

// ---------------------------------------------------------------------------
// SplitLabelBadge — label badge with an optional X button for deletion
// ---------------------------------------------------------------------------

function SplitLabelBadge({
  label,
  onDelete,
}: {
  label: string;
  onDelete: () => void;
}) {
  const colorClass = labelColor(label);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border text-xs font-normal transition-all",
        colorClass,
      )}
    >
      <span className="flex items-center gap-1 pl-2 pr-1 py-0.5">
        <Tag className="h-2.5 w-2.5 shrink-0" />
        {label}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="pr-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-r-full transition-colors"
        aria-label={`Remove label ${label}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ManageLabels — sidebar section
// ---------------------------------------------------------------------------

/**
 * Sidebar section that displays current NIP-32 labels and lets authorised
 * users (repo maintainer or issue/PR author) add new ones or delete their own.
 *
 * Each label is published immediately as a kind:1985 label event via
 * `AttachIssueLabels` — one event per label, no staging step required.
 *
 * When a label has a corresponding event in `labelEventMap` and the active
 * account is the event author, a delete (×) button is shown on the badge.
 * If the source event contained multiple labels a modal asks whether to
 * remove only the clicked label (delete + re-publish the rest) or remove
 * all labels from that event.
 */
export function ManageLabels({
  itemId,
  repoCoords,
  currentLabels,
  canEdit,
  labelEventMap,
}: ManageLabelsProps) {
  const { toast } = useToast();
  const activeAccount = useActiveAccount();

  const [inputValue, setInputValue] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Single-label confirm dialog ──────────────────────────────────────────
  const [singleDeleteEntry, setSingleDeleteEntry] =
    useState<LabelEventEntry | null>(null);
  const [singleDeleteLabel, setSingleDeleteLabel] = useState("");
  const [singleDeleting, setSingleDeleting] = useState(false);

  // ── Multi-label modal ────────────────────────────────────────────────────
  const [multiEntry, setMultiEntry] = useState<LabelEventEntry | null>(null);
  const [multiLabel, setMultiLabel] = useState("");
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiDeleting, setMultiDeleting] = useState(false);

  // Focus the text input whenever the editor opens.
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const closeEditor = useCallback(() => {
    setIsEditing(false);
    setInputValue("");
  }, []);

  /** Publish the current input value as a label immediately. */
  const applyLabel = useCallback(async () => {
    const normalised = normaliseLabel(inputValue);
    if (!normalised) return;

    if (currentLabels.includes(normalised)) {
      toast({
        title: "Label already exists",
        description: `"${normalised}" is already applied.`,
        variant: "destructive",
      });
      return;
    }

    setIsPending(true);
    try {
      await runner.run(AttachIssueLabels, itemId, [normalised], repoCoords);
      setInputValue("");
      inputRef.current?.focus();
    } catch (err) {
      toast({
        title: "Failed to add label",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }, [inputValue, currentLabels, itemId, repoCoords, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyLabel();
        return;
      }
      if (e.key === "Escape") {
        closeEditor();
      }
    },
    [applyLabel, closeEditor],
  );

  /** Called when the × on a badge is clicked. */
  const handleDeleteClick = useCallback(
    (label: string, entry: LabelEventEntry) => {
      if (entry.eventLabels.length > 1) {
        setMultiEntry(entry);
        setMultiLabel(label);
        setMultiOpen(true);
      } else {
        setSingleDeleteEntry(entry);
        setSingleDeleteLabel(label);
      }
    },
    [],
  );

  /** Delete the entire label event (single-label path). */
  const confirmSingleDelete = useCallback(async () => {
    if (!singleDeleteEntry || singleDeleting) return;
    setSingleDeleting(true);
    try {
      await runner.run(DeleteEvent, [singleDeleteEntry.event], repoCoords);
    } catch (err) {
      toast({
        title: "Failed to remove label",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSingleDeleting(false);
      setSingleDeleteEntry(null);
      setSingleDeleteLabel("");
    }
  }, [singleDeleteEntry, singleDeleting, repoCoords, toast]);

  /**
   * Multi-label "remove just this one":
   * delete the original event and re-publish with the remaining labels.
   */
  const confirmMultiRemoveOne = useCallback(async () => {
    if (!multiEntry || multiDeleting) return;
    setMultiDeleting(true);
    const remaining = multiEntry.eventLabels.filter((l) => l !== multiLabel);
    try {
      await runner.run(DeleteEvent, [multiEntry.event], repoCoords);
      if (remaining.length > 0) {
        await runner.run(AttachIssueLabels, itemId, remaining, repoCoords);
      }
    } catch (err) {
      toast({
        title: "Failed to remove label",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setMultiDeleting(false);
      setMultiOpen(false);
      setMultiEntry(null);
      setMultiLabel("");
    }
  }, [multiEntry, multiDeleting, multiLabel, repoCoords, itemId, toast]);

  /**
   * Multi-label "remove all":
   * delete the original event — no re-publish.
   */
  const confirmMultiRemoveAll = useCallback(async () => {
    if (!multiEntry || multiDeleting) return;
    setMultiDeleting(true);
    try {
      await runner.run(DeleteEvent, [multiEntry.event], repoCoords);
    } catch (err) {
      toast({
        title: "Failed to remove labels",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setMultiDeleting(false);
      setMultiOpen(false);
      setMultiEntry(null);
      setMultiLabel("");
    }
  }, [multiEntry, multiDeleting, repoCoords, toast]);

  // Nothing to show when there are no labels and the user cannot edit.
  if (!canEdit && currentLabels.length === 0) return null;

  return (
    <div>
      {/* Heading row */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">Labels</p>
        {canEdit && (
          <button
            onClick={() => (isEditing ? closeEditor() : setIsEditing(true))}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded p-0.5 hover:bg-muted"
            aria-label={isEditing ? "Close label editor" : "Add label"}
          >
            {isEditing ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Existing labels */}
      {currentLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {currentLabels.map((label) => {
            const entry = labelEventMap?.get(label);
            const isOwn = entry && activeAccount?.pubkey === entry.event.pubkey;
            if (canEdit && isOwn) {
              return (
                <SplitLabelBadge
                  key={label}
                  label={label}
                  onDelete={() => handleDeleteClick(label, entry)}
                />
              );
            }
            // Plain badge (non-deletable — from root t-tag or another user's event)
            return (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal",
                  labelColor(label),
                )}
              >
                <Tag className="h-2.5 w-2.5 shrink-0" />
                {label}
              </span>
            );
          })}
        </div>
      )}

      {/* No labels + not editing */}
      {!isEditing && currentLabels.length === 0 && (
        <p className="text-xs text-muted-foreground/50">None yet</p>
      )}

      {/* Inline input */}
      {canEdit && isEditing && (
        <div className="flex gap-1 mt-1">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="label-name"
            className="h-7 text-xs flex-1 min-w-0"
            disabled={isPending}
            aria-label="New label"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 shrink-0"
            onClick={applyLabel}
            disabled={isPending || !inputValue.trim()}
            aria-label="Add label"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
          </Button>
        </div>
      )}

      {/* ── Single-label confirm delete ─────────────────────────────────── */}
      <AlertDialog
        open={!!singleDeleteEntry}
        onOpenChange={(v) => !v && setSingleDeleteEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove label &ldquo;{singleDeleteLabel}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will send a deletion request (NIP-09) for the label event.
              Not all relays honour deletion requests.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={singleDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSingleDelete}
              disabled={singleDeleting}
            >
              {singleDeleting ? "Removing…" : "Remove label"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Multi-label modal ───────────────────────────────────────────── */}
      <Dialog open={multiOpen} onOpenChange={(v) => !v && setMultiOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove label &ldquo;{multiLabel}&rdquo;?</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            This label was added in an event that also contains:{" "}
            {multiEntry?.eventLabels
              .filter((l) => l !== multiLabel)
              .map((l) => (
                <span
                  key={l}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-xs font-normal mx-0.5",
                    labelColor(l),
                  )}
                >
                  <Tag className="h-2 w-2" />
                  {l}
                </span>
              ))}
          </p>

          <p className="text-sm text-muted-foreground">
            Would you like to remove only &ldquo;{multiLabel}&rdquo; and keep
            the others, or remove all labels from this event?
          </p>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setMultiOpen(false)}
              disabled={multiDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={confirmMultiRemoveOne}
              disabled={multiDeleting}
            >
              {multiDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Remove only &ldquo;{multiLabel}&rdquo;
            </Button>
            <Button
              variant="destructive"
              onClick={confirmMultiRemoveAll}
              disabled={multiDeleting}
            >
              {multiDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Remove all labels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
