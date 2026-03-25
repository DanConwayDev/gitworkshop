import { useState, useCallback } from "react";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  FileCode2,
  Share2,
  Braces,
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
  graspCloneUrlDomain,
  graspCloneUrlNpub,
  type ResolvedRepo,
  type FieldProvenance,
} from "@/lib/nip34";
import type { NostrEvent } from "nostr-tools";
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  const isMulti = repo.maintainerSet.length > 1;

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main: announcements */}
        <AnnouncementsSection repo={repo} isMulti={isMulti} />

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Maintainers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Maintainers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {repo.maintainerSet.map((pk) => (
                <div key={pk} className="flex items-center gap-2">
                  <UserLink
                    pubkey={pk}
                    avatarSize="md"
                    nameClassName="text-sm"
                  />
                  {pk === repo.selectedMaintainer && (
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
            </CardContent>
          </Card>

          {/* Clone URLs */}
          {repo.cloneUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  Clone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.cloneUrlProvenance.map((p) => (
                  <CloneUrlRow
                    key={p.value}
                    url={p.value}
                    ownerPubkey={isMulti ? p.pubkey : undefined}
                    selectedMaintainer={repo.selectedMaintainer}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Web URLs */}
          {repo.webUrls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Web
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {repo.webUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    {url}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Topics */}
          {repo.labels.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Topics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {repo.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relays */}
          {repo.relays.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  Relays
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {repo.relayProvenance.map((p) => (
                    <RelayRow
                      key={p.value}
                      provenance={p}
                      ownerPubkey={isMulti ? p.pubkey : undefined}
                      selectedMaintainer={repo.selectedMaintainer}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Announcements section
// ---------------------------------------------------------------------------

function AnnouncementsSection({
  repo,
  isMulti,
}: {
  repo: ResolvedRepo;
  isMulti: boolean;
}) {
  if (repo.announcements.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">
          {isMulti ? "Announcements" : "Announcement"}
        </h3>
        {isMulti && (
          <span className="text-xs text-muted-foreground">
            — clone URLs and relays are pooled; name, description, and web come
            from the most recently updated
          </span>
        )}
      </div>
      <div className="space-y-3">
        {repo.announcements.map((ev) => (
          <AnnouncementCard
            key={ev.id}
            event={ev}
            repo={repo}
            isSelected={ev.pubkey === repo.selectedMaintainer}
            isMulti={isMulti}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single announcement card
// ---------------------------------------------------------------------------

function AnnouncementCard({
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
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <UserLink
              pubkey={event.pubkey}
              avatarSize="sm"
              nameClassName="text-sm font-medium"
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
            <span className="text-xs text-muted-foreground">{createdAt}</span>
            <AnnouncementEventActions event={event} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Name / description — only on the announcement that is the source */}
        {(isNameSource || isDescSource) && (
          <div className="space-y-1">
            {isNameSource && repo.name && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">
                  name
                </span>
                <span className="text-sm font-medium">{repo.name}</span>
              </div>
            )}
            {isDescSource && repo.description && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">
                  description
                </span>
                <span className="text-sm text-foreground/80">
                  {repo.description}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Clone URLs */}
        {cloneUrls.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Clone URLs</p>
            <div className="space-y-1">
              {cloneUrls.map((url) => {
                const isGrasp = isGraspCloneUrl(url);
                const domain = isGrasp ? graspCloneUrlDomain(url) : undefined;
                const npub = isGrasp ? graspCloneUrlNpub(url) : undefined;
                return (
                  <div
                    key={url}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5"
                  >
                    <code className="flex-1 text-xs font-mono truncate text-foreground/80">
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
                    {isGrasp && npub && npub !== event.pubkey && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {npub.slice(0, 12)}…
                      </span>
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
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Relays</p>
            <div className="flex flex-wrap gap-1.5">
              {relays.map((relay) => (
                <code
                  key={relay}
                  className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded text-muted-foreground"
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
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Lists as maintainers
            </p>
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
        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <span className="text-xs text-muted-foreground">event</span>
          <code className="text-xs font-mono text-muted-foreground/70 truncate flex-1">
            {event.id}
          </code>
        </div>
      </CardContent>
    </Card>
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
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground"
          title="Share"
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground"
          title="Event JSON"
          onClick={() => setJsonOpen(true)}
        >
          <Braces className="h-3.5 w-3.5" />
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
      className="h-6 w-6 shrink-0"
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
// CloneUrlRow — sidebar clone URL with optional owner
// ---------------------------------------------------------------------------

function CloneUrlRow({
  url,
  ownerPubkey,
  selectedMaintainer,
}: {
  url: string;
  ownerPubkey?: string;
  selectedMaintainer: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  const isGrasp = isGraspCloneUrl(url);
  const domain = isGrasp ? graspCloneUrlDomain(url) : undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <code className="flex-1 text-sm font-mono truncate text-foreground/80">
          {url}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      </div>
      {ownerPubkey && (
        <div className="flex items-center gap-1.5 px-1">
          {isGrasp && domain && (
            <Badge variant="secondary" className="text-[10px]">
              grasp · {domain}
            </Badge>
          )}
          <UserLink
            pubkey={ownerPubkey}
            avatarSize="sm"
            nameClassName="text-xs text-muted-foreground"
          />
          {ownerPubkey === selectedMaintainer && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-3.5 text-violet-600 border-violet-500/40 dark:text-violet-400"
            >
              selected
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — sidebar relay with optional owner
// ---------------------------------------------------------------------------

function RelayRow({
  provenance,
  ownerPubkey,
  selectedMaintainer,
}: {
  provenance: FieldProvenance;
  ownerPubkey?: string;
  selectedMaintainer: string;
}) {
  return (
    <div className="space-y-0.5">
      <p
        className="text-xs text-muted-foreground font-mono truncate"
        title={provenance.value}
      >
        {displayRelay(provenance.value)}
      </p>
      {ownerPubkey && (
        <div className="flex items-center gap-1.5">
          <UserLink
            pubkey={ownerPubkey}
            avatarSize="sm"
            nameClassName="text-[10px] text-muted-foreground/70"
          />
          {ownerPubkey === selectedMaintainer && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-3 text-violet-600 border-violet-500/40 dark:text-violet-400"
            >
              selected
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
