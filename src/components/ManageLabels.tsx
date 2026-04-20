import { useState, useCallback, useRef, useEffect } from "react";
import { runner } from "@/services/actions";
import { AttachIssueLabels } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import { LabelBadge } from "@/components/LabelBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, X } from "lucide-react";

/** Normalise a raw label string: lowercase, trim, spaces→dashes. */
function normaliseLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
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
}

/**
 * Sidebar section that displays current NIP-32 labels and lets authorised
 * users (repo maintainer or issue/PR author) add new ones.
 *
 * Each label is published immediately as a kind:1985 label event via
 * `AttachIssueLabels` — one event per label, no staging step required.
 */
export function ManageLabels({
  itemId,
  repoCoords,
  currentLabels,
  canEdit,
}: ManageLabelsProps) {
  const { toast } = useToast();

  const [inputValue, setInputValue] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
          {currentLabels.map((label) => (
            <LabelBadge key={label} label={label} />
          ))}
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
    </div>
  );
}
