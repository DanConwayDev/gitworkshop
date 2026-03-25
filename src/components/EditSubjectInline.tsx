import { useState, useCallback, useRef, useEffect } from "react";
import { runner } from "@/services/actions";
import { RenameIssueSubject } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X, Loader2 } from "lucide-react";

interface EditableSubjectProps {
  /** The issue event ID */
  issueId: string;
  /** The current (effective) subject being displayed */
  currentSubject: string;
  /** Whether the current user is authorised to edit */
  canEdit: boolean;
  /** Relay URLs declared in the repository announcement */
  repoRelays?: string[];
}

/**
 * Editable issue subject/title.
 *
 * Renders the title as an h1. When `canEdit` is true, a pencil icon appears
 * on hover. Clicking it replaces the title with an input field and
 * save/cancel buttons. On save, publishes a NIP-32 subject-rename event
 * (kind:1985 with #subject namespace).
 */
export function EditableSubject({
  issueId,
  currentSubject,
  canEdit,
  repoRelays = [],
}: EditableSubjectProps) {
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentSubject);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync value when currentSubject changes externally (e.g. another rename
  // event arrives while the user isn't editing).
  useEffect(() => {
    if (!isEditing) {
      setValue(currentSubject);
    }
  }, [currentSubject, isEditing]);

  // Focus and select the input when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const handleEdit = useCallback(() => {
    setValue(currentSubject);
    setIsEditing(true);
  }, [currentSubject]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setValue(currentSubject);
  }, [currentSubject]);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast({
        title: "Title required",
        description: "The issue title cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    if (trimmed === currentSubject) {
      setIsEditing(false);
      return;
    }

    setIsPending(true);
    try {
      await runner.run(RenameIssueSubject, issueId, trimmed, repoRelays);

      toast({
        title: "Issue renamed",
        description: `Title updated to "${trimmed}".`,
      });

      setIsEditing(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to rename issue";
      toast({
        title: "Failed to rename issue",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }, [value, currentSubject, issueId, repoRelays, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          maxLength={200}
          className="text-xl md:text-2xl font-bold h-auto py-1 bg-background/60"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSave}
          disabled={isPending || !value.trim()}
          className="shrink-0 h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
          aria-label="Save title"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          disabled={isPending}
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Cancel editing"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group/title flex items-center gap-1.5">
      <h1 className="text-xl md:text-2xl font-bold tracking-tight">
        {currentSubject}
      </h1>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleEdit}
          className="shrink-0 h-7 w-7 text-muted-foreground/0 group-hover/title:text-muted-foreground/50 hover:!text-muted-foreground transition-colors"
          aria-label="Edit issue title"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
