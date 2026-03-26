import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { UserLink, UserAvatar, UserName } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ChevronRight,
  Server,
  Info,
} from "lucide-react";
import { graspCloneUrlNpub, type ResolvedRepo } from "@/lib/nip34";
import { GraspLogo } from "@/components/GraspLogo";
import type { NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import {
  getPointerForEvent,
  encodeDecodeResult,
  getSeenRelays,
  isAddressableKind,
  getReplaceableAddress,
} from "applesauce-core/helpers";
import { cn } from "@/lib/utils";
import { relayUrlToSegment } from "@/lib/routeUtils";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Helpers (shared)
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
 * Shorten a URL for display: replace any NIP-19 substrings with a condensed
 * form, then truncate the overall string if still long.
 */
function shortenNip19InUrl(url: string): string {
  const shortened = url.replace(
    /\b(npub1|nsec1|note1|nevent1|naddr1|nprofile1)([0-9a-z]+)/g,
    (_, prefix: string, rest: string) => {
      const full = prefix + rest;
      if (full.length <= 16) return full;
      return full.slice(0, 10) + "…" + full.slice(-4);
    },
  );
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

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface RepoAboutPanelProps {
  repo: ResolvedRepo;
  /**
   * "sidebar" — compact card layout used on the code page.
   * "full"    — expanded layout used on the /about page.
   */
  variant: "sidebar" | "full";
}

export function RepoAboutPanel({ repo, variant }: RepoAboutPanelProps) {
  const isSidebar = variant === "sidebar";

  // Build the nostr:// clone URL for ngit
  let npub: string | undefined;
  try {
    npub = nip19.npubEncode(repo.selectedMaintainer);
  } catch {
    npub = undefined;
  }
  const nostrCloneUrl = npub ? `nostr://${npub}/${repo.dTag}` : undefined;
  const nostrCloneCommand = nostrCloneUrl
    ? `git clone ${nostrCloneUrl}`
    : undefined;

  const hasAnyCloneUrl =
    repo.graspCloneUrls.length > 0 || repo.additionalGitServerUrls.length > 0;

  if (isSidebar) {
    return (
      <SidebarVariant
        repo={repo}
        nostrCloneCommand={nostrCloneCommand}
        nostrCloneUrl={nostrCloneUrl}
        hasAnyCloneUrl={hasAnyCloneUrl}
      />
    );
  }

  return (
    <FullVariant
      repo={repo}
      nostrCloneUrl={nostrCloneUrl}
      nostrCloneCommand={nostrCloneCommand}
    />
  );
}

// ---------------------------------------------------------------------------
// Sidebar variant — compact card
// ---------------------------------------------------------------------------

function SidebarVariant({
  repo,
  nostrCloneCommand,
  nostrCloneUrl,
  hasAnyCloneUrl,
}: {
  repo: ResolvedRepo;
  nostrCloneCommand: string | undefined;
  nostrCloneUrl: string | undefined;
  hasAnyCloneUrl: boolean;
}) {
  let npub: string | undefined;
  try {
    npub = nip19.npubEncode(repo.selectedMaintainer);
  } catch {
    npub = undefined;
  }
  const aboutPath = npub ? `/${npub}/${repo.dTag}/about` : undefined;
  const selectedAnnouncement = repo.announcements.find(
    (a) => a.pubkey === repo.selectedMaintainer,
  );
  const isMultiAnnouncement = repo.announcements.length > 1;
  const [multiModalOpen, setMultiModalOpen] = useState(false);

  return (
    <div className="space-y-3 min-w-0">
      {/* Clone button */}
      {(nostrCloneCommand || hasAnyCloneUrl) && (
        <CloneDropdown
          nostrCloneCommand={nostrCloneCommand}
          nostrCloneUrl={nostrCloneUrl}
          graspCloneUrls={repo.graspCloneUrls}
          additionalGitServerUrls={repo.additionalGitServerUrls}
        />
      )}

      {/* About card */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        {/* Card header */}
        <div className="px-4 pt-3 pb-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            About
          </p>
        </div>

        <div className="px-4 pt-3 pb-4 space-y-4">
          {/* Description */}
          {repo.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {repo.description}
            </p>
          )}

          {/* Web URLs */}
          {repo.webUrls.length > 0 && (
            <div className="space-y-1">
              {repo.webUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline min-w-0"
                  title={url}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{shortenNip19InUrl(url)}</span>
                </a>
              ))}
            </div>
          )}

          {/* Maintainers */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Maintainers
            </p>
            <div className="space-y-2">
              {repo.maintainerSet.map((pk) => (
                <div key={pk} className="flex items-center gap-2">
                  <UserLink
                    pubkey={pk}
                    avatarSize="sm"
                    nameClassName="text-sm"
                  />
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
            </div>
            {repo.requestedMaintainers.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground/70">Requested</p>
                {repo.requestedMaintainers.map((pk) => (
                  <UserLink
                    key={pk}
                    pubkey={pk}
                    avatarSize="sm"
                    nameClassName="text-xs text-muted-foreground"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Topics */}
          {repo.labels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Topics
              </p>
              <div className="flex flex-wrap gap-1.5">
                {repo.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Grasp server relays */}
          {repo.relays.some((r) =>
            isGraspRelay(r, repo.graspServerDomains),
          ) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <GraspLogo className="h-3 w-3 text-violet-500" />
                Grasp Servers
              </p>
              <div className="flex flex-wrap gap-1">
                {repo.relays
                  .filter((r) => isGraspRelay(r, repo.graspServerDomains))
                  .map((relay) => (
                    <Link
                      key={relay}
                      to={`/relay/${relayUrlToSegment(relay)}`}
                      title={relay}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors"
                    >
                      {displayRelay(relay)}
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {/* Other relays (non-Grasp) */}
          {repo.relays.some(
            (r) => !isGraspRelay(r, repo.graspServerDomains),
          ) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Radio className="h-3 w-3" />
                {repo.relays.some((r) =>
                  isGraspRelay(r, repo.graspServerDomains),
                )
                  ? "Other Relays"
                  : "Relays"}
              </p>
              <div className="flex flex-wrap gap-1">
                {repo.relays
                  .filter((r) => !isGraspRelay(r, repo.graspServerDomains))
                  .map((relay) => (
                    <Link
                      key={relay}
                      to={`/relay/${relayUrlToSegment(relay)}`}
                      title={relay}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {displayRelay(relay)}
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer: show more + announcement action buttons */}
        <div className="px-4 pb-3 -mt-1 flex items-center justify-between">
          {aboutPath ? (
            <Link
              to={aboutPath}
              className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors inline-flex items-center gap-0.5"
            >
              Show more
              <ChevronRight className="h-3 w-3" />
            </Link>
          ) : (
            <span />
          )}
          {isMultiAnnouncement ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
                title="View raw announcement events"
                onClick={() => setMultiModalOpen(true)}
              >
                <Braces className="h-3 w-3" />
              </Button>
              <MultiAnnouncementsModal
                announcements={repo.announcements}
                selectedMaintainer={repo.selectedMaintainer}
                open={multiModalOpen}
                onOpenChange={setMultiModalOpen}
              />
            </>
          ) : (
            selectedAnnouncement && (
              <AnnouncementEventActions event={selectedAnnouncement} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full variant — expanded /about page layout
// ---------------------------------------------------------------------------

function FullVariant({
  repo,
  nostrCloneUrl,
  nostrCloneCommand,
}: {
  repo: ResolvedRepo;
  nostrCloneUrl: string | undefined;
  nostrCloneCommand: string | undefined;
}) {
  return (
    <div className="space-y-6">
      {/* Description */}
      {repo.description && (
        <p className="text-sm text-foreground/80 leading-relaxed">
          {repo.description}
        </p>
      )}

      {/* Topics */}
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
                <Link
                  key={relay}
                  to={`/relay/${relayUrlToSegment(relay)}`}
                  title={relay}
                  className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {displayRelay(relay)}
                </Link>
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
                <Link
                  key={relay}
                  to={`/relay/${relayUrlToSegment(relay)}`}
                  title={relay}
                  className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {displayRelay(relay)}
                </Link>
              ))}
          </div>
        </section>
      )}

      {/* Clone — nostr:// address + server breakdown */}
      {(nostrCloneUrl || repo.cloneUrls.length > 0) && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Clone
          </h3>

          {/* nostr:// address — field style matching CloneDropdown */}
          {nostrCloneUrl && nostrCloneCommand && (
            <NgitCloneField command={nostrCloneCommand} />
          )}

          {/* Git server URLs with explanatory heading */}
          {repo.cloneUrls.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 pt-1">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Raw git URLs
                </h4>
                <Tooltip>
                  <Popover>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="About raw git URLs"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Git servers act as relays
                    </TooltipContent>
                    <PopoverContent
                      className="w-72 text-xs text-muted-foreground leading-relaxed"
                      side="right"
                    >
                      <p>
                        Git servers act as relays — usable as read-only remotes
                        without ngit.
                      </p>
                    </PopoverContent>
                  </Popover>
                </Tooltip>
              </div>
              <CloneServerList
                graspCloneUrls={repo.graspCloneUrls}
                additionalGitServerUrls={repo.additionalGitServerUrls}
              />
            </>
          )}
        </section>
      )}

      {/* Bottom action bar: share + raw event */}
      {repo.announcements.length > 0 && (
        <FullVariantActionBar
          announcements={repo.announcements}
          selectedMaintainer={repo.selectedMaintainer}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NgitCloneField — field-style clone command matching the CloneDropdown look
// ---------------------------------------------------------------------------

function NgitCloneField({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [command]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          ngit
          <span className="text-muted-foreground/70">(nostr git plugin)</span>
        </p>
        <a
          href="https://ngit.dev/install"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
        >
          Install ngit
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy command"
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md border px-3 py-2 min-w-0 text-left transition-colors cursor-pointer",
          copied
            ? "border-green-500/60 bg-green-500/5"
            : "border-border bg-muted/50 hover:bg-muted hover:border-border/80",
        )}
      >
        <code
          className="flex-1 text-xs font-mono text-foreground/90 truncate min-w-0 select-none"
          title={command}
        >
          {command}
        </code>
        <span className="shrink-0 text-muted-foreground transition-colors p-0.5 rounded">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CloneServerList — grouped grasp / git server rows
// ---------------------------------------------------------------------------

function CloneServerList({
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  const hasGrasp = graspCloneUrls.length > 0;
  const hasAdditional = additionalGitServerUrls.length > 0;

  if (!hasGrasp && !hasAdditional) return null;

  return (
    <div className="space-y-3">
      {hasGrasp && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <GraspLogo className="h-3 w-3 text-violet-500" />
            Grasp Servers
          </div>
          <div className="space-y-1">
            {graspCloneUrls.map((url) => (
              <CloneServerRow key={url} url={url} isGrasp />
            ))}
          </div>
        </div>
      )}

      {hasAdditional && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <Server className="h-3 w-3" />
            Other Git Servers
          </div>
          <div className="space-y-1">
            {additionalGitServerUrls.map((url) => (
              <CloneServerRow key={url} url={url} isGrasp={false} />
            ))}
          </div>
        </div>
      )}
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
      className={cn(
        "w-full text-left flex items-center gap-2.5 px-2.5 py-1.5 text-xs group transition-colors rounded border cursor-pointer",
        copied
          ? "border-green-500/60 bg-green-500/5"
          : "border-border/40 bg-muted/20 hover:bg-muted/50 hover:border-border/60",
      )}
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
      <span className="shrink-0 opacity-30 group-hover:opacity-100 transition-opacity text-muted-foreground">
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// AnnouncementEventRows — shared inner content used by both the modal and
// the collapsed section on the /about page.
// ---------------------------------------------------------------------------

function AnnouncementEventRows({
  announcements,
  selectedMaintainer,
}: {
  announcements: NostrEvent[];
  selectedMaintainer: string;
}) {
  const [jsonEvent, setJsonEvent] = useState<NostrEvent | null>(null);
  const isMulti = announcements.length > 1;

  // Sort freshest first
  const sorted = [...announcements].sort((a, b) => b.created_at - a.created_at);

  return (
    <>
      <div className="space-y-2">
        {isMulti && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            In a multi-maintainer repository each maintainer publishes their own
            announcement event. Some fields (relays, clone URLs, maintainers)
            are{" "}
            <span className="text-foreground font-medium">
              unioned across all announcements
            </span>
            , while others (name, description) are taken from the{" "}
            <span className="text-foreground font-medium">
              most recently updated
            </span>{" "}
            announcement.
          </p>
        )}

        {sorted.map((ev) => {
          const isSelected = ev.pubkey === selectedMaintainer;
          const updatedAt = format(
            new Date(ev.created_at * 1000),
            "MMM d, yyyy 'at' h:mm a",
          );
          return (
            <div
              key={ev.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isMulti ? (
                  <UserLink
                    pubkey={ev.pubkey}
                    avatarSize="sm"
                    nameClassName="text-xs font-medium"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {updatedAt}
                  </span>
                )}
                {isMulti && isSelected && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 shrink-0 text-violet-600 border-violet-500/40 dark:text-violet-400"
                  >
                    selected
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isMulti && (
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {updatedAt}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() => setJsonEvent(ev)}
                >
                  <Braces className="h-3 w-3" />
                  Raw event
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {jsonEvent && (
        <RawEventJsonDialog
          event={jsonEvent}
          open={!!jsonEvent}
          onOpenChange={(v) => {
            if (!v) setJsonEvent(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// FullVariantActionBar — share + raw event actions on the /about page
//
// Single announcement  → both share and raw event open modals directly
//                         (icon + label inline buttons, no expandable section)
// Multiple announcements → share opens the selected announcement's share modal;
//                          raw event keeps the collapsible section for all events
// ---------------------------------------------------------------------------

function FullVariantActionBar({
  announcements,
  selectedMaintainer,
}: {
  announcements: NostrEvent[];
  selectedMaintainer: string;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [rawSectionOpen, setRawSectionOpen] = useState(false);

  const isSingle = announcements.length === 1;
  const selectedAnnouncement =
    announcements.find((a) => a.pubkey === selectedMaintainer) ??
    announcements[0];
  const nip19Id = eventToNip19(selectedAnnouncement);

  return (
    <div className="pt-2">
      <Separator className="mb-4" />

      <div className="flex items-center gap-3">
        {/* Share button — always opens modal */}
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share links
        </button>

        {/* Raw event button */}
        {isSingle ? (
          <button
            type="button"
            onClick={() => setJsonOpen(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Braces className="h-3.5 w-3.5" />
            Raw announcement event
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRawSectionOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {rawSectionOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Raw announcement events ({announcements.length})
          </button>
        )}
      </div>

      {/* Multi-announcement expandable section */}
      {!isSingle && rawSectionOpen && (
        <div className="mt-3">
          <AnnouncementEventRows
            announcements={announcements}
            selectedMaintainer={selectedMaintainer}
          />
        </div>
      )}

      {/* Share modal */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share links</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1">
            <CopyRow
              label="gitworkshop.dev"
              value={`https://gitworkshop.dev/${nip19Id}`}
            />
            <CopyRow label="nostr:" value={`nostr:${nip19Id}`} />
            <CopyRow label="njump.me" value={`https://njump.me/${nip19Id}`} />
            {isAddressableKind(selectedAnnouncement.kind) ? (
              <CopyRow
                label="coordinate"
                value={
                  getReplaceableAddress(selectedAnnouncement) ??
                  selectedAnnouncement.id
                }
              />
            ) : (
              <CopyRow label="event id" value={selectedAnnouncement.id} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Raw event JSON modal (single announcement only) */}
      {isSingle && (
        <RawEventJsonDialog
          event={selectedAnnouncement}
          open={jsonOpen}
          onOpenChange={setJsonOpen}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Announcement event actions (share + JSON modal) — single event
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
          title="View raw event JSON"
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
            {isAddressableKind(event.kind) ? (
              <CopyRow
                label="coordinate"
                value={getReplaceableAddress(event) ?? event.id}
              />
            ) : (
              <CopyRow label="event id" value={event.id} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <RawEventJsonDialog
        event={event}
        open={jsonOpen}
        onOpenChange={setJsonOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// RawEventJsonDialog — reusable modal for viewing a raw event as JSON
// ---------------------------------------------------------------------------

function RawEventJsonDialog({
  event,
  open,
  onOpenChange,
}: {
  event: NostrEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
  );
}

// ---------------------------------------------------------------------------
// MultiAnnouncementsModal — shown when {} is clicked with >1 announcement
// ---------------------------------------------------------------------------

function MultiAnnouncementsModal({
  announcements,
  selectedMaintainer,
  open,
  onOpenChange,
}: {
  announcements: NostrEvent[];
  selectedMaintainer: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-muted-foreground" />
            Announcement events
          </DialogTitle>
        </DialogHeader>
        <div className="pt-1">
          <AnnouncementEventRows
            announcements={announcements}
            selectedMaintainer={selectedMaintainer}
          />
        </div>
      </DialogContent>
    </Dialog>
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
// CloneDropdown — prominent button that opens a popover (sidebar variant)
// ---------------------------------------------------------------------------

function CloneDropdown({
  nostrCloneCommand,
  nostrCloneUrl,
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  nostrCloneCommand: string | undefined;
  nostrCloneUrl: string | undefined;
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const handleCopyCommand = async () => {
    if (!nostrCloneCommand) return;
    await navigator.clipboard.writeText(nostrCloneCommand);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const hasRawUrls =
    graspCloneUrls.length > 0 || additionalGitServerUrls.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-between gap-2 bg-violet-600 hover:bg-violet-700 text-white border-0"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0" />
            <span>Clone</span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 overflow-hidden"
        align="start"
        sideOffset={4}
      >
        {/* ngit section */}
        {nostrCloneCommand && nostrCloneUrl && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                Clone with ngit
              </p>
              <a
                href="https://ngit.dev/install"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
              >
                Install ngit
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {/* Command block — entire field is the copy button */}
            <button
              type="button"
              onClick={handleCopyCommand}
              title="Copy command"
              className={cn(
                "w-full flex items-center gap-1.5 rounded-md border px-3 py-2 min-w-0 text-left transition-colors cursor-pointer",
                copiedCommand
                  ? "border-green-500/60 bg-green-500/5"
                  : "border-border bg-muted/50 hover:bg-muted hover:border-border/80",
              )}
            >
              <code
                className="flex-1 text-xs font-mono text-foreground/90 truncate min-w-0 select-none"
                title={nostrCloneCommand}
              >
                {nostrCloneCommand}
              </code>
              <span className="shrink-0 text-muted-foreground p-0.5 rounded">
                {copiedCommand ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
          </div>
        )}

        {/* Raw git URLs */}
        {hasRawUrls && (
          <>
            {nostrCloneCommand && <Separator />}
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-foreground">
                  Raw git URLs
                </p>
                <Tooltip>
                  <Popover>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="About raw git URLs"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Git servers act as relays
                    </TooltipContent>
                    <PopoverContent
                      className="w-72 text-xs text-muted-foreground leading-relaxed"
                      side="right"
                    >
                      <p>
                        Git servers act as relays — usable as read-only remotes
                        without ngit.
                      </p>
                    </PopoverContent>
                  </Popover>
                </Tooltip>
              </div>
              <CloneServerList
                graspCloneUrls={graspCloneUrls}
                additionalGitServerUrls={additionalGitServerUrls}
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
