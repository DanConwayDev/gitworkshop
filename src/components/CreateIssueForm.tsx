import { useState, useCallback, useMemo, useRef } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { runner } from "@/services/actions";
import { createAnonRunner } from "@/lib/anonPublish";
import { CreateIssue } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { LabelBadge } from "@/components/LabelBadge";
import { NostrComposer } from "@/components/NostrComposer";
import { composerHasNsec, hasPreviewableContent } from "@/lib/composerUtils";
import { extractContentTags } from "@/lib/nostrContentTags";
import type { Nip94Tags } from "@/hooks/useBlossomUpload";
import { Loader2, Plus, X, CircleDot } from "lucide-react";
import { Expressions } from "applesauce-core/helpers/regexp";
import { stripInvisibleChar } from "applesauce-core/helpers/string";

/** Normalise a hashtag/label the same way applesauce does: lowercase + strip invisible chars. */
function normaliseHashtag(tag: string): string {
  return stripInvisibleChar(tag.toLocaleLowerCase());
}

/**
 * Returns true if the string is a valid hashtag per applesauce's regex
 * (Unicode letters, numbers, and marks only — no spaces, hyphens, underscores, etc.).
 */
function isValidHashtag(tag: string): boolean {
  return /^[\p{L}\p{N}\p{M}]+$/u.test(tag);
}

/**
 * Extract #hashtags from content using applesauce's Expressions.hashtag regex,
 * normalised with the same logic applesauce uses.
 */
function extractHashtags(text: string): string[] {
  const re = new RegExp(Expressions.hashtag.source, Expressions.hashtag.flags);
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    results.push(normaliseHashtag(match[1]));
  }
  return [...new Set(results)];
}

/**
 * A label badge for content-derived hashtags. Shows a dimmed X button that
 * fires onLockClick when pressed so the parent can show a shared hint.
 */
function LockedLabelBadge({
  label,
  onLockClick,
}: {
  label: string;
  onLockClick: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <LabelBadge label={label} />
      <button
        type="button"
        onClick={onLockClick}
        className="ml-0.5 rounded-full p-0.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
        aria-label={`Cannot remove label ${label} — derived from #hashtag in description`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

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
  const { toast } = useToast();

  const account = useActiveAccount();
  const isLoggedIn = !!account;

  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [labelInput, setLabelInput] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [anonMode, setAnonMode] = useState(false);
  const [showHashtagHint, setShowHashtagHint] = useState(false);
  /** NIP-94 tag groups accumulated from Blossom uploads in this session */
  const [uploadedTagGroups, setUploadedTagGroups] = useState<Nip94Tags[]>([]);
  const { openAuthModal } = useAuthModal();
  const hashtagHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Labels derived from #hashtags in the content — read-only, auto-synced
  const contentLabels = useMemo(() => extractHashtags(content), [content]);

  const handleLockClick = useCallback(() => {
    setShowHashtagHint(true);
    if (hashtagHintTimerRef.current) clearTimeout(hashtagHintTimerRef.current);
    hashtagHintTimerRef.current = setTimeout(
      () => setShowHashtagHint(false),
      3500,
    );
  }, []);

  const addLabel = useCallback(() => {
    const raw = labelInput.trim();
    if (!raw) {
      setLabelInput("");
      setLabelError(null);
      return;
    }

    if (!isValidHashtag(raw)) {
      setLabelError(
        "Labels can only contain letters, numbers, and combining marks — no spaces, hyphens, or underscores.",
      );
      return;
    }

    const normalised = normaliseHashtag(raw);
    if (labels.includes(normalised) || contentLabels.includes(normalised)) {
      setLabelInput("");
      setLabelError(null);
      return;
    }

    setLabels((prev) => [...prev, normalised]);
    setLabelInput("");
    setLabelError(null);
  }, [labelInput, labels, contentLabels]);

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

  const handleUploadedTags = useCallback((tags: Nip94Tags) => {
    setUploadedTagGroups((prev) => [...prev, tags]);
  }, []);

  const submitIssue = useCallback(
    async (
      trimmedSubject: string,
      trimmedContent: string,
      allLabels: string[],
      useAnonMode: boolean,
    ) => {
      const activeRunner =
        !isLoggedIn && useAnonMode ? createAnonRunner() : runner;

      // Build imeta tags from all uploads in this compose session
      const extraTags = uploadedTagGroups.map((group) => {
        const fields = group.map(([k, v]) => `${k} ${v}`);
        return ["imeta", ...fields];
      });

      setIsPending(true);
      try {
        await activeRunner.run(
          CreateIssue,
          repoCoord,
          ownerPubkey,
          trimmedSubject,
          trimmedContent,
          {
            labels: allLabels,
            contentTags: extractContentTags(trimmedContent),
            extraTags: extraTags.length > 0 ? extraTags : undefined,
          },
        );

        toast({
          title: "Issue created",
          description: `"${trimmedSubject}" has been published.`,
        });

        setUploadedTagGroups([]);
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
    [repoCoord, ownerPubkey, toast, onSuccess, isLoggedIn, uploadedTagGroups],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedSubject = subject.trim();
      if (!trimmedSubject) {
        toast({
          title: "Title required",
          description: "Please provide a title for the issue.",
          variant: "destructive",
        });
        return;
      }

      const trimmedContent = content.trim();
      const allLabels = [...new Set([...contentLabels, ...labels])];

      // Not logged in and not anonymous — open auth modal and retry on success
      if (!isLoggedIn && !anonMode) {
        openAuthModal("landing", () =>
          submitIssue(trimmedSubject, trimmedContent, allLabels, false),
        );
        return;
      }

      await submitIssue(trimmedSubject, trimmedContent, allLabels, anonMode);
    },
    [
      subject,
      content,
      contentLabels,
      labels,
      toast,
      isLoggedIn,
      anonMode,
      openAuthModal,
      submitIssue,
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
        <div className="flex items-center justify-between">
          <Label htmlFor="issue-content" className="text-sm font-medium">
            Description
          </Label>
          {hasPreviewableContent(content) && (
            <div className="flex items-center gap-1">
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
        </div>
        <NostrComposer
          value={content}
          onChange={setContent}
          placeholder="Describe the issue in detail. Markdown is supported."
          disabled={isPending}
          rows={8}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onUploadedTags={handleUploadedTags}
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
            onChange={(e) => {
              setLabelInput(e.target.value);
              setLabelError(null);
            }}
            onKeyDown={handleLabelKeyDown}
            disabled={isPending}
            className={`bg-background/60 flex-1 ${labelError ? "border-destructive focus-visible:ring-destructive" : ""}`}
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

        {labelError && <p className="text-xs text-destructive">{labelError}</p>}

        {(contentLabels.length > 0 || labels.length > 0) && (
          <div className="space-y-1.5 pt-1">
            <div className="flex flex-wrap gap-1.5">
              {/* Content-derived hashtag labels — locked */}
              {contentLabels.map((label) => (
                <LockedLabelBadge
                  key={`content-${label}`}
                  label={label}
                  onLockClick={handleLockClick}
                />
              ))}
              {/* Manually added labels — removable */}
              {labels.map((label) => (
                <div
                  key={`manual-${label}`}
                  className="flex items-center gap-0.5"
                >
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
            {showHashtagHint && (
              <p className="text-xs text-muted-foreground">
                Labels derived from <span className="font-mono">#hashtags</span>{" "}
                in the description are removed by editing the description.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Anonymous checkbox — only shown when not logged in */}
        {!isLoggedIn ? (
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="issue-anon"
              checked={anonMode}
              onCheckedChange={(checked) => setAnonMode(checked === true)}
              disabled={isPending}
              className="h-3.5 w-3.5"
            />
            <Label
              htmlFor="issue-anon"
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Anonymous
            </Label>
          </div>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
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
            disabled={isPending || !subject.trim() || composerHasNsec(content)}
            className="gap-1.5 bg-pink-600 hover:bg-pink-700 text-white"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing...
              </>
            ) : (
              <>
                <CircleDot className="h-3.5 w-3.5" />
                Submit issue
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
