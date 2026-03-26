import { useState, useCallback } from "react";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { UserLink, UserAvatar, UserName } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Globe,
  Copy,
  Check,
  Users,
  Tag,
  Radio,
  ExternalLink,
  GitBranch,
  Share2,
  Braces,
  ChevronDown,
  ChevronUp,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isGraspCloneUrl,
  graspCloneUrlNpub,
  graspCloneUrlDomain,
  type ResolvedRepo,
} from "@/lib/nip34";
import { GraspLogo } from "@/components/GraspLogo";
import type { NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import {
  getPointerForEvent,
  encodeDecodeResult,
  getSeenRelays,
} from "applesauce-core/helpers";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventToNip19(event: NostrEvent): string {
  const relays = Array.from(getSeenRelays(event) ?? []).slice(0, 2);
  const pointer = getPointerForEvent(event, relays);
  return encodeDecodeResult(pointer);
}

function displayRelay(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

/**
 * Shorten a URL for display: replace any npub1/nsec1/note1/nevent1/naddr1/nprofile1
 * substrings with a condensed form, then truncate the overall string if still long.
 */
function shortenNip19InUrl(url: string): string {
  // Replace each NIP-19 identifier with a condensed version
  const shortened = url.replace(
    /\b(npub1|nsec1|note1|nevent1|naddr1|nprofile1)([0-9a-z]+)/g,
    (_, prefix: string, rest: string) => {
      const full = prefix + rest;
      if (full.length <= 16) return full;
      return full.slice(0, 10) + "…" + full.slice(-4);
    },
  );
  // If still very long, truncate the whole thing
  if (shortened.length > 60) {
    return shortened.slice(0, 57) + "…";
  }
  return shortened;
}

/** Returns true if a relay URL's hostname matches one of the Grasp server domains. */
function isGraspRelay(relayUrl: string, graspDomains: string[]): boolean {
  if (!graspDomains.length) return false;
  try {
    const hostname = new URL(relayUrl).hostname;
    return graspDomains.includes(hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepoAboutPage() {
  const { resolved } = useRepoContext();
  const repo = resolved?.repo;

  useSeoMeta({
    title: repo ? `${repo.name} - about - ngit` : "About - ngit",
    description: repo?.description ?? "Repository details",
  });

  if (!repo) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        <div className="space-y-3 max-w-lg">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="pt-4 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="max-w-2xl space-y-6">
        <MainInfo repo={repo} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main info — all fields in display order
// ---------------------------------------------------------------------------

function MainInfo({ repo }: { repo: ResolvedRepo }) {
  const [showRaw, setShowRaw] = useState(false);
  const isMulti = repo.maintainerSet.length > 1;

  return (
    <div className="space-y-6">
      {/* About / description */}
      {repo.description && (
        <p className="text-sm text-foreground/80 leading-relaxed">
          {repo.description}
        </p>
      )}

      {/* Labels / topics */}
      {repo.labels.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Topics
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {repo.labels.map((label) => (
              <Badge key={label} variant="secondary" className="text-xs">
                {label}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Website */}
      {repo.webUrls.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            Website
          </h3>
          <div className="space-y-1">
            {repo.webUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={url}
                className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline min-w-0"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{shortenNip19InUrl(url)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Maintainers */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Maintainers
        </h3>
        <div className="space-y-2.5">
          {repo.maintainerSet.map((pk) => (
            <div key={pk} className="flex items-center gap-2">
              <UserLink pubkey={pk} avatarSize="md" nameClassName="text-sm" />
              {pk === repo.selectedMaintainer &&
                repo.maintainerSet.length > 1 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 text-violet-600 border-violet-500/40 dark:text-violet-400"
                  >
                    selected
                  </Badge>
                )}
            </div>
          ))}
          {repo.requestedMaintainers.length > 0 && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">Requested</p>
              {repo.requestedMaintainers.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="sm"
                  nameClassName="text-xs text-muted-foreground"
                />
              ))}
            </>
          )}
        </div>
      </section>

      {/* Grasp Server relays */}
      {repo.relays.some((r) => isGraspRelay(r, repo.graspServerDomains)) && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <GraspLogo className="h-3.5 w-3.5 text-violet-500" />
            Grasp Servers
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {repo.relays
              .filter((r) => isGraspRelay(r, repo.graspServerDomains))
              .map((relay) => (
                <code
                  key={relay}
                  className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded text-muted-foreground"
                  title={relay}
                >
                  {displayRelay(relay)}
                </code>
              ))}
          </div>
        </section>
      )}

      {/* Other Relays (non-Grasp) */}
      {repo.relays.some((r) => !isGraspRelay(r, repo.graspServerDomains)) && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            {repo.relays.some((r) => isGraspRelay(r, repo.graspServerDomains))
              ? "Other Relays"
              : "Relays"}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {repo.relays
              .filter((r) => !isGraspRelay(r, repo.graspServerDomains))
              .map((relay) => (
                <code
                  key={relay}
                  className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded text-muted-foreground"
                  title={relay}
                >
                  {displayRelay(relay)}
                </code>
              ))}
          </div>
        </section>
      )}

      {/* Clone URLs (Grasp clone URLs + Other Git Servers grouped inside) */}
      {repo.cloneUrls.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Clone
          </h3>
          <CloneServerList
            graspCloneUrls={repo.graspCloneUrls}
            additionalGitServerUrls={repo.additionalGitServerUrls}
          />
        </section>
      )}

      {/* Raw announcements toggle */}
      {repo.announcements.length > 0 && (
        <div className="pt-2">
          <Separator className="mb-4" />
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRaw ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showRaw ? "Hide" : "View"} raw announcement
            {repo.announcements.length > 1
              ? `s (${repo.announcements.length})`
              : ""}
            {isMulti && !showRaw && (
              <span className="text-muted-foreground/60">
                — see how multiple announcements combine
              </span>
            )}
          </button>

          {showRaw && (
            <div className="mt-3 space-y-3">
              {repo.announcements.map((ev) => (
                <RawAnnouncementCard
                  key={ev.id}
                  event={ev}
                  repo={repo}
                  isSelected={ev.pubkey === repo.selectedMaintainer}
                  isMulti={isMulti}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raw announcement card (shown when user expands)
// ---------------------------------------------------------------------------

function RawAnnouncementCard({
  event,
  repo,
  isSelected,
  isMulti,
}: {
  event: NostrEvent;
  repo: ResolvedRepo;
  isSelected: boolean;
  isMulti: boolean;
}) {
  const cloneUrls = repo.cloneUrlProvenance
    .filter((p) => p.pubkey === event.pubkey)
    .map((p) => p.value);

  const relays = repo.relayProvenance
    .filter((p) => p.pubkey === event.pubkey)
    .map((p) => p.value);

  const listedMaintainers = repo.maintainerEdges
    .filter((e) => e.from === event.pubkey)
    .map((e) => e.to);

  const isNameSource = repo.nameSource.pubkey === event.pubkey;
  const isDescSource = repo.descriptionSource.pubkey === event.pubkey;

  const createdAt = format(
    new Date(event.created_at * 1000),
    "MMM d, yyyy 'at' h:mm a",
  );

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <UserLink
            pubkey={event.pubkey}
            avatarSize="sm"
            nameClassName="text-xs font-medium"
          />
          {isMulti && isSelected && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 shrink-0 text-violet-600 border-violet-500/40 dark:text-violet-400"
            >
              selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-muted-foreground">{createdAt}</span>
          <AnnouncementEventActions event={event} />
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2.5 text-xs">
        {/* Name / description */}
        {(isNameSource || isDescSource) && (
          <div className="space-y-1">
            {isNameSource && repo.name && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">
                  name
                </span>
                <span className="font-medium">{repo.name}</span>
              </div>
            )}
            {isDescSource && repo.description && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">
                  description
                </span>
                <span className="text-foreground/80">{repo.description}</span>
              </div>
            )}
          </div>
        )}

        {/* Clone URLs */}
        {cloneUrls.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Clone URLs</p>
            <div className="space-y-1">
              {cloneUrls.map((url) => {
                const isGrasp = isGraspCloneUrl(url);
                const domain = isGrasp ? graspCloneUrlDomain(url) : undefined;
                return (
                  <div
                    key={url}
                    className="flex items-center gap-2 rounded border bg-background/60 px-2 py-1"
                  >
                    <code className="flex-1 font-mono truncate text-foreground/80">
                      {url}
                    </code>
                    {isGrasp && domain && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] shrink-0"
                      >
                        grasp
                      </Badge>
                    )}
                    <CopyButton value={url} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Relays */}
        {relays.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Relays</p>
            <div className="flex flex-wrap gap-1">
              {relays.map((relay) => (
                <code
                  key={relay}
                  className="font-mono bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground"
                  title={relay}
                >
                  {displayRelay(relay)}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Listed maintainers */}
        {listedMaintainers.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">Lists as maintainers</p>
            <div className="flex flex-wrap gap-2">
              {listedMaintainers.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="sm"
                  nameClassName="text-xs"
                />
              ))}
            </div>
          </div>
        )}

        {/* Event ID */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
          <span className="text-muted-foreground/70">event</span>
          <code className="font-mono text-muted-foreground/60 truncate flex-1">
            {event.id}
          </code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Announcement event actions (share + JSON modal)
// ---------------------------------------------------------------------------

function AnnouncementEventActions({ event }: { event: NostrEvent }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const nip19Id = eventToNip19(event);

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
          title="Share"
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
          title="Event JSON"
          onClick={() => setJsonOpen(true)}
        >
          <Braces className="h-3 w-3" />
        </Button>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1">
            <CopyRow
              label="gitworkshop.dev"
              value={`https://gitworkshop.dev/${nip19Id}`}
            />
            <CopyRow label="nostr:" value={`nostr:${nip19Id}`} />
            <CopyRow label="njump.me" value={`https://njump.me/${nip19Id}`} />
            <CopyRow label="event id" value={event.id} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Announcement event JSON</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded-md border bg-muted/40 p-4 min-h-0">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// CopyRow — labelled row with copy-on-click (share modal)
// ---------------------------------------------------------------------------

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "group grid w-full grid-cols-[6rem_1fr_1.5rem] items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors",
        "border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        copied ? "border-green-500" : "border-border",
      )}
    >
      <span
        className={cn(
          "font-medium shrink-0",
          copied ? "text-green-600" : "text-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono truncate min-w-0",
          copied ? "text-green-600" : "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CopyButton — inline icon button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [value]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// CloneServerList — grouped grasp / git server rows, styled like GitServerPanel
// ---------------------------------------------------------------------------

function npubToPubkey(npub: string): string | undefined {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
    return undefined;
  } catch {
    return undefined;
  }
}

function condenseNpub(npub: string): string {
  if (npub.length <= 12) return npub;
  return npub.slice(0, 8) + "…" + npub.slice(-2);
}

function condenseGraspUrl(url: string): string {
  const npub = graspCloneUrlNpub(url);
  if (!npub) return url;
  return url.replace(npub, condenseNpub(npub));
}

function CloneServerList({
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  const hasGrasp = graspCloneUrls.length > 0;
  const hasAdditional = additionalGitServerUrls.length > 0;

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      {hasGrasp && (
        <div>
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <GraspLogo className="h-3 w-3 text-violet-500" />
            Grasp Servers
          </div>
          {graspCloneUrls.map((url) => (
            <CloneServerRow key={url} url={url} isGrasp />
          ))}
        </div>
      )}

      {hasGrasp && hasAdditional && <Separator />}

      {hasAdditional && (
        <div>
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <Server className="h-3 w-3" />
            Other Git Servers
          </div>
          {additionalGitServerUrls.map((url) => (
            <CloneServerRow key={url} url={url} isGrasp={false} />
          ))}
        </div>
      )}

      {/* If only one type exists and has no section header needed (single type, no label ambiguity) */}
      {!hasGrasp && !hasAdditional && null}
    </div>
  );
}

function CloneServerRow({ url, isGrasp }: { url: string; isGrasp: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

  const npub = isGrasp ? (graspCloneUrlNpub(url) ?? undefined) : undefined;
  const pubkey = npub ? npubToPubkey(npub) : undefined;
  const displayUrl = isGrasp ? condenseGraspUrl(url) : url;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs group transition-colors hover:bg-accent/30 cursor-pointer"
      aria-label={`Copy clone URL: ${url}`}
    >
      <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
        <p
          className="font-mono text-[11px] break-all leading-snug text-foreground/80"
          title={url}
        >
          {displayUrl}
        </p>
        {isGrasp && (pubkey ?? npub) && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-popover px-1.5 py-0.5 shadow-sm whitespace-nowrap font-sans leading-none shrink-0">
            {pubkey ? (
              <>
                <UserAvatar
                  pubkey={pubkey}
                  size="sm"
                  className="h-3.5 w-3.5 text-[6px] shrink-0"
                />
                <UserName
                  pubkey={pubkey}
                  className="text-[10px] text-muted-foreground font-normal"
                />
              </>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground">
                {condenseNpub(npub!)}
              </span>
            )}
          </span>
        )}
      </div>
      <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </span>
    </button>
  );
}
