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
 * Adding a label publishes a kind:1985 label event via `AttachIssueLabels`.
 * Labels are additive — existing labels are never removed by this component.
 */
export function ManageLabels({
  itemId,
  repoCoords,
  currentLabels,
  canEdit,
}: ManageLabelsProps) {
  const { toast } = useToast();

  // Local "staged" labels  — typed but not yet submitted.
  const [staged, setStaged] = useState<string[]>([]);
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

  /** Append the current input value to the staged list. */
  const stageLabel = useCallback(() => {
    const normalised = normaliseLabel(inputValue);
    if (!normalised) return;

    const alreadyExists =
      currentLabels.includes(normalised) || staged.includes(normalised);
    if (alreadyExists) {
      toast({
        title: "Label already exists",
        description: `"${normalised}" is already applied.`,
        variant: "destructive",
      });
      return;
    }
    setStaged((prev) => [...prev, normalised]);
    setInputValue("");
  }, [inputValue, currentLabels, staged, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        stageLabel();
        return;
      }
      if (e.key === "Escape") {
        setIsEditing(false);
        setStaged([]);
        setInputValue("");
      }
    },
    [stageLabel],
  );

  const removeStaged = useCallback((label: string) => {
    setStaged((prev) => prev.filter((l) => l !== label));
  }, []);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setStaged([]);
    setInputValue("");
  }, []);

  const handleApply = useCallback(async () => {
    // Stage whatever is still in the input first.
    const extra = normaliseLabel(inputValue);
    const toPublish = [
      ...staged,
      ...(extra && !currentLabels.includes(extra) && !staged.includes(extra)
        ? [extra]
        : []),
    ];

    if (toPublish.length === 0) {
      setIsEditing(false);
      setInputValue("");
      return;
    }

    setIsPending(true);
    try {
      await runner.run(AttachIssueLabels, itemId, toPublish, repoCoords);
      toast({
        title: toPublish.length === 1 ? "Label added" : "Labels added",
        description: toPublish.map((l) => `"${l}"`).join(", "),
      });
      setStaged([]);
      setInputValue("");
      setIsEditing(false);
    } catch (err) {
      toast({
        title: "Failed to add labels",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }, [inputValue, staged, currentLabels, itemId, repoCoords, toast]);

  // Nothing to show when there are no labels and the user cannot edit.
  if (!canEdit && currentLabels.length === 0) return null;

  return (
    <div>
      {/* Heading row */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">Labels</p>
        {canEdit && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded p-0.5 hover:bg-muted"
            aria-label="Add label"
          >
            <Plus className="h-3.5 w-3.5" />
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

      {/* Inline editor */}
      {canEdit && isEditing && (
        <div className="space-y-2 mt-1">
          {/* Staged (not yet saved) labels */}
          {staged.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {staged.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-0.5 text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                >
                  {label}
                  <button
                    onClick={() => removeStaged(label)}
                    aria-label={`Remove "${label}"`}
                    className="hover:text-foreground transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Text input row */}
          <div className="flex gap-1">
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
              onClick={stageLabel}
              disabled={isPending || !inputValue.trim()}
              aria-label="Stage label"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* Apply / Cancel */}
          <div className="flex gap-1.5 justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={handleCancel}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleApply}
              disabled={
                isPending || (staged.length === 0 && !inputValue.trim())
              }
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
