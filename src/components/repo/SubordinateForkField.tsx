import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import {
  isRepoUpstreamSelfReference,
  parseRepoCoordinate,
  type RepoUpstream,
} from "@/lib/nip34";
import {
  parseUpstreamInput,
  type ParsedUpstreamInput,
  type PendingNip05Upstream,
} from "@/lib/repoUpstreamInput";
import { repoToPath } from "@/lib/routeUtils";
import { cn } from "@/lib/utils";
import type { UpstreamNip05Status } from "@/hooks/useResolvedUpstreamNip05";

interface SubordinateForkFieldProps {
  upstream: RepoUpstream;
  upstreamInput: string;
  pendingNip05?: PendingNip05Upstream;
  nip05Status: UpstreamNip05Status;
  editorOpen: boolean;
  inputBlurred: boolean;
  focusRequest: number;
  repoPubkey: string;
  repoIdentifier: string;
  repoCloneUrls: string[];
  onInputChange(input: string, parsed: ParsedUpstreamInput): void;
  onInputBlur(): void;
  onOpenEditor(): void;
  onCloseEditor(): void;
  onClear(): void;
}

function isValidRepoUpstream(upstream: RepoUpstream): boolean {
  return !!(upstream.repository?.trim() || upstream.gitUrl?.trim());
}

function IdentifiedUpstreamBadge({ upstream }: { upstream: RepoUpstream }) {
  const parsed = parseRepoCoordinate(upstream.repository);
  if (!parsed) return null;

  const repoPath = repoToPath(
    parsed.pubkey,
    parsed.identifier,
    upstream.relayHint ? [upstream.relayHint] : [],
  );

  return (
    <Link
      to={repoPath}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-1 text-xs transition-colors hover:bg-muted/60"
      title={upstream.repository}
    >
      <UserAvatar
        pubkey={parsed.pubkey}
        size="xs"
        className="shrink-0"
        noHoverCard
      />
      <UserName pubkey={parsed.pubkey} className="min-w-0 max-w-32 truncate" />
      <span className="text-muted-foreground">/</span>
      <Badge
        variant="secondary"
        className="max-w-40 truncate rounded-full px-1.5 py-0 font-mono text-[10px]"
      >
        {parsed.identifier}
      </Badge>
    </Link>
  );
}

export function SubordinateForkField({
  upstream,
  upstreamInput,
  pendingNip05,
  nip05Status,
  editorOpen,
  inputBlurred,
  focusRequest,
  repoPubkey,
  repoIdentifier,
  repoCloneUrls,
  onInputChange,
  onInputBlur,
  onOpenEditor,
  onCloseEditor,
  onClear,
}: SubordinateForkFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValidUpstream = isValidRepoUpstream(upstream);
  const isSelfReferentialUpstream = isRepoUpstreamSelfReference(
    upstream,
    repoPubkey,
    repoIdentifier,
    repoCloneUrls,
  );
  const isResolvingUpstreamNip05 = nip05Status === "loading";
  const isSubordinateFork = hasValidUpstream && !isSelfReferentialUpstream;
  const identifiedNostrUpstream = isSubordinateFork
    ? parseRepoCoordinate(upstream.repository)
    : undefined;
  const hasInvalidInput =
    editorOpen &&
    upstreamInput.trim().length > 0 &&
    !isResolvingUpstreamNip05 &&
    (!hasValidUpstream || isSelfReferentialUpstream);
  const showInvalidInput = editorOpen && inputBlurred && hasInvalidInput;
  const inputErrorMessage = isSelfReferentialUpstream
    ? "A repository cannot use itself as its upstream."
    : pendingNip05
      ? nip05Status === "not-found"
        ? `${pendingNip05.nip05} could not be resolved.`
        : nip05Status === "error"
          ? `Failed to resolve ${pendingNip05.nip05}.`
          : "Invalid repository link or git URL."
      : "Invalid repository link or git URL.";

  useEffect(() => {
    if (!editorOpen || focusRequest === 0) return;
    inputRef.current?.focus();
  }, [editorOpen, focusRequest]);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-md border border-border/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40",
          identifiedNostrUpstream
            ? "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            : "flex items-start gap-2.5",
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Checkbox
            id="edit-subordinate-fork"
            checked={isSubordinateFork}
            onCheckedChange={(checked) => {
              if (checked === true) {
                onOpenEditor();
                return;
              }

              onCloseEditor();
              onClear();
            }}
            className="mt-0.5"
          />
          <label
            htmlFor="edit-subordinate-fork"
            className="cursor-pointer space-y-0.5"
          >
            <span className="block text-sm font-medium leading-none">
              subordinate fork
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              this is not the repo for the primary project
            </span>
          </label>
        </div>

        {identifiedNostrUpstream ? (
          <span className="flex min-w-0 items-center gap-2 pl-7 sm:pl-0">
            <IdentifiedUpstreamBadge upstream={upstream} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear subordinate fork"
              onClick={() => {
                onCloseEditor();
                onClear();
              }}
              className="h-7 w-7 shrink-0 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        ) : null}
      </div>

      {editorOpen && !identifiedNostrUpstream ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Repository link or git URL
            </Label>
            <Input
              ref={inputRef}
              value={upstreamInput}
              onChange={(event) => {
                const value = event.target.value;
                onInputChange(value, parseUpstreamInput(value));
              }}
              onBlur={onInputBlur}
              placeholder='"nostr://..." or "https://github.com/org/repo.git"'
              aria-invalid={showInvalidInput}
              className={cn(
                "h-8 text-xs font-mono",
                showInvalidInput &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {showInvalidInput ? (
              <p className="text-[11px] font-medium text-destructive">
                {inputErrorMessage}
              </p>
            ) : isResolvingUpstreamNip05 && pendingNip05 ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Resolving{" "}
                <code className="font-mono">{pendingNip05.nip05}</code>…
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Also accepts <code className="font-mono">naddr1…</code>,{" "}
                <code className="font-mono">nostr://npub1…/repo</code>,{" "}
                <code className="font-mono">nostr://nip05/relay/repo</code>,{" "}
                <code className="font-mono">gitworkshop.dev</code> repo URLs,{" "}
                <code className="font-mono">npub1…/repo</code>, and repository
                coordinates. The checkbox checks itself when a valid reference
                is detected.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
