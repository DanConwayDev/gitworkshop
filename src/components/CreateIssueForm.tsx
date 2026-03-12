import { useState, useCallback } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { factory } from "@/services/actions";
import { publish } from "@/services/nostr";
import { IssueBlueprint } from "@/blueprints/issue";
import { NGIT_RELAYS } from "@/lib/nip34";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LabelBadge } from "@/components/LabelBadge";
import { Loader2, Plus, X, CircleDot } from "lucide-react";
import { pool } from "@/services/nostr";

interface CreateIssueFormProps {
  /** Repository coordinate: "30617:<pubkey>:<d-tag>" */
  repoCoord: string;
  /** Hex pubkey of the repository owner */
  ownerPubkey: string;
  /** Called after the issue is successfully published */
  onSuccess?: () => void;
  /** Called when the user cancels */
  onCancel?: () => void;
}

export function CreateIssueForm({
  repoCoord,
  ownerPubkey,
  onSuccess,
  onCancel,
}: CreateIssueFormProps) {
  const account = useActiveAccount();
  const { toast } = useToast();

  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);

  const addLabel = useCallback(() => {
    const trimmed = labelInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed || labels.includes(trimmed)) {
      setLabelInput("");
      return;
    }
    setLabels((prev) => [...prev, trimmed]);
    setLabelInput("");
  }, [labelInput, labels]);

  const removeLabel = useCallback((label: string) => {
    setLabels((prev) => prev.filter((l) => l !== label));
  }, []);

  const handleLabelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addLabel();
      }
    },
    [addLabel],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!account) {
        toast({
          title: "Not logged in",
          description: "You must be logged in to create an issue.",
          variant: "destructive",
        });
        return;
      }

      const trimmedSubject = subject.trim();
      if (!trimmedSubject) {
        toast({
          title: "Title required",
          description: "Please provide a title for the issue.",
          variant: "destructive",
        });
        return;
      }

      setIsPending(true);
      try {
        const template = await factory.create(
          IssueBlueprint,
          repoCoord,
          ownerPubkey,
          trimmedSubject,
          content.trim(),
          { labels },
        );
        const signed = await factory.sign(template);

        // Publish to both the ngit relay and any user-configured relays
        await publish(signed, NGIT_RELAYS);

        // Also publish to the repo's own relay set if available
        await pool.publish(NGIT_RELAYS, signed);

        toast({
          title: "Issue created",
          description: `"${trimmedSubject}" has been published.`,
        });

        onSuccess?.();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create issue";
        toast({
          title: "Failed to create issue",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsPending(false);
      }
    },
    [
      account,
      subject,
      content,
      labels,
      repoCoord,
      ownerPubkey,
      toast,
      onSuccess,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="issue-subject" className="text-sm font-medium">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="issue-subject"
          placeholder="Short, descriptive title for the issue"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isPending}
          maxLength={200}
          autoFocus
          className="bg-background/60"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="issue-content" className="text-sm font-medium">
          Description
        </Label>
        <Textarea
          id="issue-content"
          placeholder="Describe the issue in detail. Markdown is supported."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isPending}
          rows={8}
          className="bg-background/60 resize-y font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Markdown supported — code blocks, links, lists, etc.
        </p>
      </div>

      {/* Labels */}
      <div className="space-y-1.5">
        <Label htmlFor="issue-labels" className="text-sm font-medium">
          Labels
        </Label>
        <div className="flex gap-2">
          <Input
            id="issue-labels"
            placeholder="Add a label and press Enter"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={handleLabelKeyDown}
            disabled={isPending}
            className="bg-background/60 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLabel}
            disabled={isPending || !labelInput.trim()}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {labels.map((label) => (
              <div key={label} className="flex items-center gap-0.5">
                <LabelBadge label={label} />
                <button
                  type="button"
                  onClick={() => removeLabel(label)}
                  disabled={isPending}
                  className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label={`Remove label ${label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={isPending || !subject.trim() || !account}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Publishing...
            </>
          ) : (
            <>
              <CircleDot className="h-3.5 w-3.5" />
              Submit issue
            </>
          )}
        </Button>
      </div>

      {!account && (
        <p className="text-xs text-muted-foreground text-center">
          You must be logged in to submit an issue.
        </p>
      )}
    </form>
  );
}
