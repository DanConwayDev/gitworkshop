/**
 * RepoSettingsPage — edit repository settings for the selected maintainer.
 *
 * Allows editing:
 *   - Basic info: name, description, web URLs, topics
 *   - Default branch (kind:30618 HEAD pointer)
 *   - Grasp servers (with NIP-11 validation, same as CreateRepoDialog)
 *   - Other relays (non-Grasp relay URLs)
 *   - Other git servers (non-Grasp clone URLs)
 *
 * Read-only / auto-populated:
 *   - Clone URLs generated from selected Grasp servers
 *   - Relay URLs generated from selected Grasp servers
 *   - Items contributed only by co-maintainers (displayed as info)
 *
 * Only accessible when the logged-in user is the selected maintainer.
 */

import {
  type ReactNode,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useActiveAccount } from "applesauce-react/hooks";
import { IdentityStatus } from "applesauce-loaders/helpers";
import {
  ArrowLeft,
  Plus,
  X,
  Loader2,
  Server,
  Radio,
  GitBranch,
  AlertTriangle,
  Users,
  Tag,
  CircleHelp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import type { EventTemplate } from "nostr-tools";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar, UserLink, UserName } from "@/components/UserAvatar";
import { UserAutocompleteDropdown } from "@/components/UserAutocompleteDropdown";

import { useRepoContext } from "./RepoContext";
import {
  REPO_KIND,
  REPO_STATE_KIND,
  getRepoName,
  getRepoDescription,
  getRepoCloneUrls,
  getRepoRelays,
  getRepoWebUrls,
  getRepoMaintainers,
  getRepoUpstreams,
  isGraspCloneUrl,
  graspCloneUrlDomain,
  computeMaintainerLeadership,
  type RepoUpstream,
  type ResolvedRepo,
} from "@/lib/nip34";
import type { RepositoryState } from "@/casts/RepositoryState";
import {
  decodePubkeyIdentifier,
  parseRepoRoute,
  repoToPath,
} from "@/lib/routeUtils";
import { validateGraspServer } from "@/lib/grasp";
import { dnsIdentityLoader, nip05WarmupReady, publish } from "@/services/nostr";
import { useGraspServers } from "@/hooks/useGraspServers";
import { DEFAULT_GRASP_SERVERS } from "@/services/settings";
import { GraspLogo } from "@/components/GraspLogo";
import { cn } from "@/lib/utils";
import { normalizeUrl } from "@/lib/url";

// ---------------------------------------------------------------------------
// Known tag names — tags that the settings form explicitly manages.
// Any tag with a name NOT in this set is treated as "unknown" and preserved
// verbatim so that data from other clients is never silently dropped.
// ---------------------------------------------------------------------------

const KNOWN_TAG_NAMES = new Set([
  "d",
  "name",
  "description",
  "clone",
  "relays",
  "alt",
  "r",
  "maintainers",
  "web",
  "t",
  "u",
]);

const HEX_PUBKEY_INPUT_RE = /^[0-9a-fA-F]{64}$/;
const LEAD_MAINTAINER_HELP_TEXT =
  "The lead maintainer is the confirmed maintainer listed by more confirmed maintainers than anyone else. If the top listing count is tied, there is no single lead maintainer.";

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tagArraysEqual(a: string[][], b: string[][]): boolean {
  return (
    a.length === b.length &&
    a.every((tag, index) => stringArraysEqual(tag, b[index] ?? []))
  );
}

function repoUpstreamsEqual(a: RepoUpstream[], b: RepoUpstream[]): boolean {
  return tagArraysEqual(repoUpstreamsToTags(a), repoUpstreamsToTags(b));
}

function repoUpstreamsToTags(upstreams: RepoUpstream[]): string[][] {
  return upstreams
    .map((upstream) => {
      const repository = upstream.repository?.trim() ?? "";
      const gitUrl = upstream.gitUrl?.trim() ?? "";
      const relayHint = upstream.relayHint?.trim() ?? "";
      const authorPubkey = upstream.authorPubkey?.trim() ?? "";
      const target = repository || gitUrl;
      if (!target) return undefined;

      const tag = ["u", target];
      if (authorPubkey) tag.push(relayHint, authorPubkey);
      else if (relayHint) tag.push(relayHint);
      return tag;
    })
    .filter((tag): tag is string[] => tag !== undefined);
}

function emptyRepoUpstream(): RepoUpstream {
  return { repository: "", gitUrl: "", relayHint: "", authorPubkey: "" };
}

function repoCoordinate(pubkey: string, identifier: string): string {
  return `${REPO_KIND}:${pubkey}:${identifier}`;
}

interface PendingNip05Upstream {
  nip05: string;
  repoId: string;
  relayHint: string;
  gitUrl: string;
}

type ParsedRepoLink =
  | { type: "resolved"; upstream: RepoUpstream }
  | {
      type: "nip05";
      nip05: string;
      repoId: string;
      relayHint: string;
    };

interface ParsedUpstreamInput {
  upstream: RepoUpstream;
  pendingNip05?: Omit<PendingNip05Upstream, "gitUrl">;
}

function parseRepoCoordinate(
  coordinate: string | undefined,
): { pubkey: string; identifier: string } | undefined {
  if (!coordinate?.startsWith(`${REPO_KIND}:`)) return undefined;
  const rest = coordinate.slice(`${REPO_KIND}:`.length);
  const separator = rest.indexOf(":");
  if (separator === -1) return undefined;

  const pubkey = rest.slice(0, separator);
  const identifier = rest.slice(separator + 1);
  const decodedPubkey = decodePubkeyIdentifier(pubkey);
  if (!decodedPubkey || !identifier) return undefined;
  return { pubkey: decodedPubkey, identifier };
}

function parseNaddrUpstream(input: string): RepoUpstream | undefined {
  const match = input.match(/\b(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)\b/i);
  if (!match) return undefined;

  try {
    const decoded = nip19.decode(match[1].toLowerCase());
    if (decoded.type !== "naddr" || decoded.data.kind !== REPO_KIND) {
      return undefined;
    }

    return {
      repository: repoCoordinate(decoded.data.pubkey, decoded.data.identifier),
      relayHint: decoded.data.relays?.[0] ?? "",
      authorPubkey: decoded.data.pubkey,
      gitUrl: "",
    };
  } catch {
    return undefined;
  }
}

function parsedRouteToRepoLink(
  parsed: ReturnType<typeof parseRepoRoute>,
): ParsedRepoLink | undefined {
  if (!parsed) return undefined;

  if (parsed.type === "npub") {
    return {
      type: "resolved",
      upstream: {
        repository: repoCoordinate(parsed.pubkey, parsed.repoId),
        relayHint: parsed.relayHints[0] ?? "",
        authorPubkey: parsed.pubkey,
        gitUrl: "",
      },
    };
  }

  return {
    type: "nip05",
    nip05: parsed.nip05,
    repoId: parsed.repoId,
    relayHint: parsed.relayHints[0] ?? "",
  };
}

function parseRepoPathUpstream(path: string): ParsedRepoLink | undefined {
  const segments = path.split("/").filter(Boolean);

  for (let index = 0; index < segments.length - 1; index++) {
    for (const width of [3, 2]) {
      const candidate = segments.slice(index, index + width).join("/");
      const parsed = parsedRouteToRepoLink(parseRepoRoute(candidate));
      if (parsed) return parsed;
    }
  }

  return undefined;
}

function parseNostrCloneUpstream(input: string): ParsedRepoLink | undefined {
  const match = input.match(/\bnostr:\/\/\S+/i);
  if (!match) return undefined;

  try {
    const url = new URL(match[0]);
    return parseRepoPathUpstream(`${url.hostname}${url.pathname}`);
  } catch {
    return undefined;
  }
}

function isGitworkshopHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "gitworkshop.dev" || lower === "www.gitworkshop.dev";
}

function normalizeGitworkshopRepoPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const withoutHost =
    first === "gitworkshop.dev" || first === "www.gitworkshop.dev"
      ? segments.slice(1)
      : segments;
  const prefix = withoutHost[0];

  if (prefix === "r" || prefix === "p") return withoutHost.slice(1).join("/");
  return withoutHost.join("/");
}

function parseWebRepoPathUpstream(input: string): ParsedRepoLink | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.pathname.endsWith(".git")) return undefined;
    const path = isGitworkshopHost(url.hostname)
      ? normalizeGitworkshopRepoPath(url.pathname)
      : url.pathname;
    return parseRepoPathUpstream(path);
  } catch {
    return parseRepoPathUpstream(normalizeGitworkshopRepoPath(input));
  }
}

function parseCoordinateUpstream(input: string): RepoUpstream | undefined {
  const target = input.split("|")[0]?.trim();
  const parsed = parseRepoCoordinate(target);
  if (!parsed || !target) return undefined;

  return {
    repository: target,
    relayHint: "",
    authorPubkey: parsed.pubkey,
    gitUrl: "",
  };
}

function extractGitUrl(input: string, hasRepoLink: boolean): string {
  const match = input.match(/\b(?:https?|ssh|git):\/\/\S+|\bgit@\S+/i);
  const raw = match?.[0]?.replace(/[),.;]+$/, "") ?? "";
  if (!raw) return "";

  if (!hasRepoLink) return raw;
  if (raw.endsWith(".git") || raw.includes(".git?")) return raw;
  return "";
}

function parseUpstreamInput(input: string): ParsedUpstreamInput {
  const trimmed = input.trim();
  if (!trimmed) return { upstream: emptyRepoUpstream() };

  const repoLink =
    (() => {
      const naddr = parseNaddrUpstream(trimmed);
      return naddr
        ? ({ type: "resolved", upstream: naddr } as const)
        : undefined;
    })() ??
    parseNostrCloneUpstream(trimmed) ??
    (() => {
      const coordinate = parseCoordinateUpstream(trimmed);
      return coordinate
        ? ({ type: "resolved", upstream: coordinate } as const)
        : undefined;
    })() ??
    parseWebRepoPathUpstream(trimmed);
  const gitUrl = extractGitUrl(trimmed, !!repoLink);

  if (repoLink?.type === "resolved") {
    return {
      upstream: {
        ...repoLink.upstream,
        gitUrl,
      },
    };
  }

  if (repoLink?.type === "nip05") {
    return {
      upstream: {
        repository: "",
        relayHint: repoLink.relayHint,
        authorPubkey: "",
        gitUrl,
      },
      pendingNip05: repoLink,
    };
  }

  return {
    upstream: {
      repository: "",
      relayHint: "",
      authorPubkey: "",
      gitUrl,
    },
  };
}

function isValidRepoUpstream(upstream: RepoUpstream): boolean {
  return !!(upstream.repository?.trim() || upstream.gitUrl?.trim());
}

function isRepoUpstreamSelfReference(
  upstream: RepoUpstream,
  repoPubkey: string,
  repoIdentifier: string,
  repoCloneUrls: string[],
): boolean {
  const parsed = parseRepoCoordinate(upstream.repository);
  if (parsed?.pubkey === repoPubkey && parsed.identifier === repoIdentifier) {
    return true;
  }

  const gitUrl = upstream.gitUrl?.trim();
  if (!gitUrl) return false;

  const normalizedGitUrl = normalizeUrl(gitUrl);
  return repoCloneUrls.some((url) => normalizeUrl(url) === normalizedGitUrl);
}

function formatUpstreamInput(upstream: RepoUpstream): string {
  const parts: string[] = [];
  const parsed = parseRepoCoordinate(upstream.repository);

  if (parsed) {
    const npub = nip19.npubEncode(parsed.pubkey);
    const relayHint = upstream.relayHint
      ?.replace(/^wss?:\/\//, "")
      .replace(/\/$/, "");
    const encodedIdentifier = encodeURIComponent(parsed.identifier);
    parts.push(
      relayHint
        ? `nostr://${npub}/${relayHint}/${encodedIdentifier}`
        : `nostr://${npub}/${encodedIdentifier}`,
    );
  } else if (upstream.repository) {
    parts.push(upstream.repository);
  }

  if (upstream.gitUrl) parts.push(upstream.gitUrl);
  return parts.join(" ");
}

function looksLikeDirectPubkeyInput(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.toLowerCase().startsWith("npub1") ||
    HEX_PUBKEY_INPUT_RE.test(trimmed)
  );
}

function LeadMaintainerHelp() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="How lead maintainers are chosen"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-64 text-xs leading-relaxed"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {LEAD_MAINTAINER_HELP_TEXT}
      </PopoverContent>
    </Popover>
  );
}

function LeadMaintainerSummary({
  children,
  hasLead,
  className,
}: {
  children?: ReactNode;
  hasLead: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span>{hasLead ? "Lead maintainer" : "No lead maintainer"}</span>
      <LeadMaintainerHelp />
      {hasLead ? children : null}
    </div>
  );
}

function LeadBadge() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 items-center rounded-full border border-pink-500/40 px-1.5 py-0 text-[10px] font-semibold text-pink-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-pink-400"
          aria-label="How lead maintainers are chosen"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          lead
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-64 text-xs leading-relaxed"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {LEAD_MAINTAINER_HELP_TEXT}
      </PopoverContent>
    </Popover>
  );
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepoSettingsPage() {
  const { resolved, nip05, repoState } = useRepoContext();
  const account = useActiveAccount();
  const repo = resolved?.repo;

  const isMaintainer =
    account?.pubkey && repo && account.pubkey === repo.selectedMaintainer;

  const basePath = repo
    ? repoToPath(repo.selectedMaintainer, repo.dTag, repo.relays, nip05)
    : undefined;

  if (!repo || !basePath) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  if (!isMaintainer) {
    return (
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="max-w-md">
          <div className="flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-medium">Not authorised</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Only the selected maintainer can edit these repository settings.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={`${basePath}/about`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to About
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RepoSettingsForm repo={repo} basePath={basePath} repoState={repoState} />
  );
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------

interface RepoSettingsFormProps {
  repo: ResolvedRepo;
  basePath: string;
  repoState?: RepositoryState | null;
  title?: string;
}

function RepoSettingsForm({
  repo,
  basePath,
  repoState,
  title = "Repository settings",
}: RepoSettingsFormProps) {
  const account = useActiveAccount();
  const navigate = useNavigate();

  // Find the selected maintainer's own announcement
  const selectedAnnouncement = useMemo(
    () => repo.announcements.find((a) => a.pubkey === repo.selectedMaintainer),
    [repo],
  );

  // Grasp server resolution (for the known server list)
  const { servers: resolvedServers, isFromUserList } = useGraspServers(
    account?.pubkey,
  );

  // ---------------------------------------------------------------------------
  // Parse current values from the selected announcement
  // ---------------------------------------------------------------------------

  const currentCloneUrls = useMemo(
    () => (selectedAnnouncement ? getRepoCloneUrls(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentRelayUrls = useMemo(
    () => (selectedAnnouncement ? getRepoRelays(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentGraspCloneUrls = useMemo(
    () => currentCloneUrls.filter(isGraspCloneUrl),
    [currentCloneUrls],
  );
  const currentGraspDomains = useMemo(
    () => [
      ...new Set(
        currentGraspCloneUrls
          .map(graspCloneUrlDomain)
          .filter((d): d is string => !!d),
      ),
    ],
    [currentGraspCloneUrls],
  );
  const currentOtherGitServers = useMemo(
    () => currentCloneUrls.filter((u) => !isGraspCloneUrl(u)),
    [currentCloneUrls],
  );
  const currentOtherRelays = useMemo(() => {
    const graspDomainSet = new Set(currentGraspDomains);
    return currentRelayUrls.filter((r) => {
      try {
        return !graspDomainSet.has(new URL(r).hostname);
      } catch {
        return true;
      }
    });
  }, [currentRelayUrls, currentGraspDomains]);

  const currentWebUrls = useMemo(
    () => (selectedAnnouncement ? getRepoWebUrls(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentTopics = useMemo(
    () =>
      selectedAnnouncement?.tags
        .filter(([t]) => t === "t")
        .map(([, v]) => v)
        .filter(
          (value): value is string => !!value && value !== "personal-fork",
        ) ?? [],
    [selectedAnnouncement],
  );
  const currentUpstreams = useMemo(
    () => (selectedAnnouncement ? getRepoUpstreams(selectedAnnouncement) : []),
    [selectedAnnouncement],
  );
  const currentMaintainers = useMemo(() => {
    if (!selectedAnnouncement) return [];
    return Array.from(
      new Set(
        getRepoMaintainers(selectedAnnouncement).flatMap((identifier) => {
          const pubkey = decodePubkeyIdentifier(identifier);
          return pubkey && pubkey !== repo.selectedMaintainer ? [pubkey] : [];
        }),
      ),
    );
  }, [selectedAnnouncement, repo.selectedMaintainer]);
  const currentEucHash = useMemo(
    () =>
      selectedAnnouncement?.tags.find(
        ([t, , marker]) => t === "r" && marker === "euc",
      )?.[1] ?? "",
    [selectedAnnouncement],
  );

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  const [name, setName] = useState(
    selectedAnnouncement ? getRepoName(selectedAnnouncement) : "",
  );
  const [description, setDescription] = useState(
    selectedAnnouncement ? getRepoDescription(selectedAnnouncement) : "",
  );
  const [webUrls, setWebUrls] = useState<string[]>(currentWebUrls);
  const [webInput, setWebInput] = useState("");
  const [topics, setTopics] = useState<string[]>(currentTopics);
  const [topicInput, setTopicInput] = useState("");
  const [upstream, setUpstream] = useState<RepoUpstream>(
    () => currentUpstreams[0] ?? emptyRepoUpstream(),
  );
  const [upstreamInput, setUpstreamInput] = useState<string>(() =>
    formatUpstreamInput(currentUpstreams[0] ?? emptyRepoUpstream()),
  );
  const [pendingUpstreamNip05, setPendingUpstreamNip05] =
    useState<PendingNip05Upstream>();
  const [upstreamNip05Status, setUpstreamNip05Status] = useState<
    "idle" | "loading" | "not-found" | "error"
  >("idle");
  const [subordinateForkEditorOpen, setSubordinateForkEditorOpen] = useState(
    () => currentUpstreams.length > 0,
  );
  const [subordinateForkInputBlurred, setSubordinateForkInputBlurred] =
    useState(false);
  const [subordinateForkFocusRequest, setSubordinateForkFocusRequest] =
    useState(0);
  const upstreamInputRef = useRef<HTMLInputElement>(null);

  // Co-maintainers listed by this selected announcement.
  const [editedMaintainers, setEditedMaintainers] =
    useState<string[]>(currentMaintainers);
  const [maintainerInput, setMaintainerInput] = useState("");
  const [maintainerInputError, setMaintainerInputError] = useState<
    string | undefined
  >();

  // Grasp server selection
  const [selectedDomains, setSelectedDomains] =
    useState<string[]>(currentGraspDomains);
  const [customDomain, setCustomDomain] = useState("");
  const [customDomainError, setCustomDomainError] = useState<
    string | undefined
  >();
  const [validatingDomain, setValidatingDomain] = useState(false);

  // Other relays
  const [otherRelays, setOtherRelays] = useState<string[]>(currentOtherRelays);
  const [relayInput, setRelayInput] = useState("");
  const [relayInputError, setRelayInputError] = useState<string | undefined>();

  // Other git servers
  const [otherGitServers, setOtherGitServers] = useState<string[]>(
    currentOtherGitServers,
  );
  const [gitServerInput, setGitServerInput] = useState("");
  const [gitServerInputError, setGitServerInputError] = useState<
    string | undefined
  >();

  // Earliest unique commit hash
  const [eucHash, setEucHash] = useState(currentEucHash);

  // Default branch from the repository state event
  const branches = useMemo(() => {
    if (!repoState) return [];
    return repoState.refs
      .filter((r) => r.name.startsWith("refs/heads/"))
      .map((r) => r.name.replace("refs/heads/", ""))
      .sort();
  }, [repoState]);
  const currentHeadBranch = repoState?.headBranch ?? null;
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [userHasSelectedBranch, setUserHasSelectedBranch] = useState(false);

  // Unknown / custom tags — tags not managed by the form fields above.
  // Stored as string[][] so multi-value tags and repeated tag names are
  // preserved exactly. Initialised once from the selected announcement.
  const [unknownTags, setUnknownTags] = useState<string[][]>(() => {
    if (!selectedAnnouncement) return [];
    return selectedAnnouncement.tags.filter(
      ([name]) => name !== undefined && !KNOWN_TAG_NAMES.has(name),
    );
  });

  // Other-section open state (auto-open if the repo already has entries there)
  const [otherRelaysOpen, setOtherRelaysOpen] = useState(
    () => currentOtherRelays.length > 0,
  );
  const [otherGitServersOpen, setOtherGitServersOpen] = useState(
    () => currentOtherGitServers.length > 0,
  );
  const [unknownTagsOpen, setUnknownTagsOpen] = useState(
    () =>
      !!selectedAnnouncement?.tags.some(
        ([name]) => name !== undefined && !KNOWN_TAG_NAMES.has(name),
      ),
  );

  // Submit state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  const editedCloneUrls = useMemo(() => {
    const npub = nip19.npubEncode(repo.selectedMaintainer);
    const encodedId = encodeURIComponent(repo.dTag);
    const graspCloneUrls = selectedDomains.map(
      (domain) => `https://${domain}/${npub}/${encodedId}.git`,
    );

    return Array.from(
      new Set([...repo.cloneUrls, ...graspCloneUrls, ...otherGitServers]),
    );
  }, [
    repo.selectedMaintainer,
    repo.dTag,
    repo.cloneUrls,
    selectedDomains,
    otherGitServers,
  ]);

  const hasValidUpstream = isValidRepoUpstream(upstream);
  const isSelfReferentialUpstream = isRepoUpstreamSelfReference(
    upstream,
    repo.selectedMaintainer,
    repo.dTag,
    editedCloneUrls,
  );
  const isResolvingUpstreamNip05 = upstreamNip05Status === "loading";
  const isSubordinateFork = hasValidUpstream && !isSelfReferentialUpstream;
  const hasInvalidSubordinateForkInput =
    subordinateForkEditorOpen &&
    upstreamInput.trim().length > 0 &&
    !isResolvingUpstreamNip05 &&
    (!hasValidUpstream || isSelfReferentialUpstream);
  const identifiedNostrUpstream = isSubordinateFork
    ? parseRepoCoordinate(upstream.repository)
    : undefined;
  const showInvalidSubordinateForkInput =
    subordinateForkEditorOpen &&
    subordinateForkInputBlurred &&
    hasInvalidSubordinateForkInput;
  const upstreamInputErrorMessage = isSelfReferentialUpstream
    ? "A repository cannot use itself as its upstream."
    : pendingUpstreamNip05
      ? upstreamNip05Status === "not-found"
        ? `${pendingUpstreamNip05.nip05} could not be resolved.`
        : upstreamNip05Status === "error"
          ? `Failed to resolve ${pendingUpstreamNip05.nip05}.`
          : "Invalid repository link or git URL."
      : "Invalid repository link or git URL.";

  const effectiveUpstreams = useMemo(
    () => (isSubordinateFork ? [upstream] : []),
    [isSubordinateFork, upstream],
  );

  const focusSubordinateForkInput = useCallback(() => {
    setSubordinateForkEditorOpen(true);
    setSubordinateForkFocusRequest((request) => request + 1);
  }, []);

  useEffect(() => {
    if (!subordinateForkEditorOpen || subordinateForkFocusRequest === 0) return;
    upstreamInputRef.current?.focus();
  }, [subordinateForkEditorOpen, subordinateForkFocusRequest]);

  useEffect(() => {
    if (!pendingUpstreamNip05) {
      setUpstreamNip05Status("idle");
      return;
    }

    const atIndex = pendingUpstreamNip05.nip05.indexOf("@");
    if (atIndex === -1) {
      setUpstreamNip05Status("error");
      return;
    }

    const name = pendingUpstreamNip05.nip05.slice(0, atIndex);
    const domain = pendingUpstreamNip05.nip05.slice(atIndex + 1);
    let cancelled = false;

    setUpstreamNip05Status("loading");

    const resolveIdentity = async () => {
      await nip05WarmupReady;

      const cached = dnsIdentityLoader.getIdentity(name, domain);
      const identity =
        cached ?? (await dnsIdentityLoader.loadIdentity(name, domain));

      dnsIdentityLoader.identities.set(`${name}@${domain}`, identity);
      return identity;
    };

    resolveIdentity()
      .then((identity) => {
        if (cancelled) return;

        if (identity.status !== IdentityStatus.Found) {
          setUpstreamNip05Status("not-found");
          return;
        }

        const resolvedUpstream: RepoUpstream = {
          repository: repoCoordinate(
            identity.pubkey,
            pendingUpstreamNip05.repoId,
          ),
          relayHint: pendingUpstreamNip05.relayHint,
          authorPubkey: identity.pubkey,
          gitUrl: pendingUpstreamNip05.gitUrl,
        };

        setUpstream(resolvedUpstream);
        setPendingUpstreamNip05(undefined);
        setSubordinateForkInputBlurred(
          isRepoUpstreamSelfReference(
            resolvedUpstream,
            repo.selectedMaintainer,
            repo.dTag,
            editedCloneUrls,
          ),
        );
        setUpstreamNip05Status("idle");
      })
      .catch(() => {
        if (!cancelled) setUpstreamNip05Status("error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    pendingUpstreamNip05,
    repo.selectedMaintainer,
    repo.dTag,
    editedCloneUrls,
  ]);

  // Sync selectedDomains with the current Grasp domains on first render
  useEffect(() => {
    setSelectedDomains(currentGraspDomains);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (userHasSelectedBranch) return;
    setSelectedBranch(currentHeadBranch ?? branches[0] ?? "");
  }, [currentHeadBranch, branches, userHasSelectedBranch]);

  // ---------------------------------------------------------------------------
  // Computed: all known Grasp domains (resolved + custom added)
  // ---------------------------------------------------------------------------

  const allKnownDomains = useMemo(() => {
    const fromResolved = resolvedServers.map((s) => s.domain);
    // Also include any domains that are already selected but not in the user's
    // resolved list (they came from the existing announcement)
    const extra = selectedDomains.filter((d) => !fromResolved.includes(d));
    // Make sure current announcement domains are always visible
    const fromAnnouncement = currentGraspDomains.filter(
      (d) => !fromResolved.includes(d) && !extra.includes(d),
    );
    return [...fromResolved, ...extra, ...fromAnnouncement];
  }, [resolvedServers, selectedDomains, currentGraspDomains]);

  // ---------------------------------------------------------------------------
  // Union items from other maintainers
  // ---------------------------------------------------------------------------

  const isMultiMaintainer = repo.maintainerSet.length > 1;

  const maintainerLeadership = useMemo(
    () => computeMaintainerLeadership(repo.maintainerSet, repo.maintainerEdges),
    [repo.maintainerSet, repo.maintainerEdges],
  );

  const maintainerListers = useMemo(
    () =>
      computeMaintainerListers(
        repo.maintainerSet,
        repo.maintainerSet,
        repo.maintainerEdges,
      ),
    [repo.maintainerSet, repo.maintainerEdges],
  );

  const requestedMaintainers = useMemo(
    () => Array.from(new Set(repo.requestedMaintainers)),
    [repo.requestedMaintainers],
  );

  const requestedMaintainerListers = useMemo(
    () =>
      computeMaintainerListers(
        requestedMaintainers,
        repo.maintainerSet,
        repo.maintainerEdges,
      ),
    [requestedMaintainers, repo.maintainerSet, repo.maintainerEdges],
  );

  const maintainerPickerPriorityPubkeys = useMemo(
    () => Array.from(new Set([...repo.maintainerSet, ...requestedMaintainers])),
    [repo.maintainerSet, requestedMaintainers],
  );

  const maintainerPickerExcludePubkeys = useMemo(
    () => [repo.selectedMaintainer, ...editedMaintainers],
    [repo.selectedMaintainer, editedMaintainers],
  );

  const unionOnlyRelays = useMemo((): Array<{
    url: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myRelays = new Set(
      getRepoRelays(selectedAnnouncement).map(normalizeUrl),
    );
    return repo.relays
      .filter((r) => !myRelays.has(normalizeUrl(r)))
      .map((url) => ({
        url,
        contributorPubkey:
          repo.relayProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }));
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.relays,
    repo.relayProvenance,
  ]);

  const unionOnlyGitServers = useMemo((): Array<{
    url: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myCloneUrls = new Set(
      getRepoCloneUrls(selectedAnnouncement).map(normalizeUrl),
    );
    return repo.cloneUrls
      .filter((u) => !myCloneUrls.has(normalizeUrl(u)) && !isGraspCloneUrl(u))
      .map((url) => ({
        url,
        contributorPubkey:
          repo.cloneUrlProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }));
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.cloneUrls,
    repo.cloneUrlProvenance,
  ]);

  const unionOnlyGraspDomains = useMemo((): Array<{
    domain: string;
    contributorPubkey: string;
  }> => {
    if (!isMultiMaintainer || !selectedAnnouncement) return [];
    const myCloneUrls = new Set(getRepoCloneUrls(selectedAnnouncement));
    const myGraspDomains = new Set(
      Array.from(myCloneUrls)
        .filter(isGraspCloneUrl)
        .map(graspCloneUrlDomain)
        .filter(Boolean),
    );
    return repo.graspCloneUrls
      .filter((u) => {
        const domain = graspCloneUrlDomain(u);
        return domain && !myGraspDomains.has(domain);
      })
      .map((url) => ({
        domain: graspCloneUrlDomain(url) ?? url,
        contributorPubkey:
          repo.cloneUrlProvenance.find((p) => p.value === url)?.pubkey ?? "",
      }))
      .filter(
        (item, idx, arr) =>
          arr.findIndex((x) => x.domain === item.domain) === idx,
      );
  }, [
    isMultiMaintainer,
    selectedAnnouncement,
    repo.graspCloneUrls,
    repo.cloneUrlProvenance,
  ]);

  // ---------------------------------------------------------------------------
  // Grasp server actions
  // ---------------------------------------------------------------------------

  const handleToggleServer = useCallback((domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((d) => d !== domain)
        : [...prev, domain],
    );
  }, []);

  const handleAddCustomDomain = useCallback(async () => {
    const raw = customDomain.trim().toLowerCase();
    if (!raw) return;

    const domain = raw.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      setCustomDomainError("Enter a valid domain (e.g. relay.example.com)");
      return;
    }
    if (selectedDomains.includes(domain)) {
      setCustomDomainError("Already in the list");
      return;
    }

    setValidatingDomain(true);
    setCustomDomainError(undefined);
    const validationError = await validateGraspServer(domain);
    setValidatingDomain(false);

    if (validationError) {
      setCustomDomainError(validationError);
      return;
    }

    setSelectedDomains((prev) => [...prev, domain]);
    setCustomDomain("");
    setCustomDomainError(undefined);
  }, [customDomain, selectedDomains]);

  // ---------------------------------------------------------------------------
  // Other relay actions
  // ---------------------------------------------------------------------------

  const handleAddRelay = useCallback(() => {
    const raw = relayInput.trim();
    if (!raw) return;
    let url = raw;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
      url = `wss://${url}`;
    }
    try {
      new URL(url);
    } catch {
      setRelayInputError(
        "Enter a valid WebSocket URL (e.g. wss://relay.example.com)",
      );
      return;
    }
    if (otherRelays.includes(url)) {
      setRelayInputError("Already in the list");
      return;
    }
    setOtherRelays((prev) => [...prev, url]);
    setRelayInput("");
    setRelayInputError(undefined);
  }, [relayInput, otherRelays]);

  const handleRemoveRelay = useCallback((url: string) => {
    setOtherRelays((prev) => prev.filter((r) => r !== url));
  }, []);

  // ---------------------------------------------------------------------------
  // Other git server actions
  // ---------------------------------------------------------------------------

  const handleAddGitServer = useCallback(() => {
    const raw = gitServerInput.trim();
    if (!raw) return;
    try {
      new URL(raw);
    } catch {
      setGitServerInputError(
        "Enter a valid URL (e.g. https://github.com/user/repo.git)",
      );
      return;
    }
    if (isGraspCloneUrl(raw)) {
      setGitServerInputError(
        "This looks like a Grasp server URL — use the Grasp Servers section instead",
      );
      return;
    }
    if (otherGitServers.includes(raw)) {
      setGitServerInputError("Already in the list");
      return;
    }
    setOtherGitServers((prev) => [...prev, raw]);
    setGitServerInput("");
    setGitServerInputError(undefined);
  }, [gitServerInput, otherGitServers]);

  const handleRemoveGitServer = useCallback((url: string) => {
    setOtherGitServers((prev) => prev.filter((u) => u !== url));
  }, []);

  // ---------------------------------------------------------------------------
  // Web URL actions
  // ---------------------------------------------------------------------------

  const handleAddWebUrl = useCallback(() => {
    const raw = webInput.trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      new URL(url);
    } catch {
      return;
    }
    if (webUrls.includes(url)) return;
    setWebUrls((prev) => [...prev, url]);
    setWebInput("");
  }, [webInput, webUrls]);

  // ---------------------------------------------------------------------------
  // Topic actions
  // ---------------------------------------------------------------------------

  const handleAddTopic = useCallback(() => {
    const raw = topicInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!raw || topics.includes(raw)) return;
    setTopics((prev) => [...prev, raw]);
    setTopicInput("");
  }, [topicInput, topics]);

  // ---------------------------------------------------------------------------
  // Maintainer actions
  // ---------------------------------------------------------------------------

  const addMaintainerPubkey = useCallback(
    (pubkey: string) => {
      if (pubkey === repo.selectedMaintainer) {
        setMaintainerInputError("You cannot add yourself as a co-maintainer");
        return;
      }
      if (editedMaintainers.includes(pubkey)) {
        setMaintainerInputError("Already in the list");
        return;
      }

      setEditedMaintainers((prev) =>
        prev.includes(pubkey) ? prev : [...prev, pubkey],
      );
      setMaintainerInput("");
      setMaintainerInputError(undefined);
    },
    [repo.selectedMaintainer, editedMaintainers],
  );

  const handleAddMaintainer = useCallback(() => {
    const raw = maintainerInput.trim();
    if (!raw) return;

    const pubkey = decodePubkeyIdentifier(raw);
    if (!pubkey) {
      setMaintainerInputError("Enter a valid hex pubkey or npub");
      return;
    }
    addMaintainerPubkey(pubkey);
  }, [maintainerInput, addMaintainerPubkey]);

  const handleRemoveMaintainer = useCallback((pubkey: string) => {
    setEditedMaintainers((prev) => prev.filter((pk) => pk !== pubkey));
  }, []);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const hasInfrastructure =
    selectedDomains.length > 0 ||
    (otherRelays.length > 0 && otherGitServers.length > 0);

  const announcementFieldsChanged =
    name.trim() !==
      (selectedAnnouncement ? getRepoName(selectedAnnouncement) : "") ||
    description.trim() !==
      (selectedAnnouncement ? getRepoDescription(selectedAnnouncement) : "") ||
    !stringArraysEqual(webUrls, currentWebUrls) ||
    !stringArraysEqual(topics, currentTopics) ||
    !repoUpstreamsEqual(effectiveUpstreams, currentUpstreams) ||
    !stringArraysEqual(editedMaintainers, currentMaintainers) ||
    !stringArraysEqual(selectedDomains, currentGraspDomains) ||
    !stringArraysEqual(otherRelays, currentOtherRelays) ||
    !stringArraysEqual(otherGitServers, currentOtherGitServers) ||
    eucHash.trim() !== currentEucHash ||
    !tagArraysEqual(
      unknownTags,
      selectedAnnouncement?.tags.filter(
        ([tagName]) => tagName !== undefined && !KNOWN_TAG_NAMES.has(tagName),
      ) ?? [],
    );

  const defaultBranchChanged =
    userHasSelectedBranch &&
    selectedBranch.length > 0 &&
    selectedBranch !== currentHeadBranch;
  const hasChanges = announcementFieldsChanged || defaultBranchChanged;
  const canSave =
    name.trim().length > 0 &&
    hasInfrastructure &&
    hasChanges &&
    (!defaultBranchChanged || !!repoState) &&
    !hasInvalidSubordinateForkInput &&
    !isResolvingUpstreamNip05 &&
    !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave || !account) return;
    if (!selectedAnnouncement) return;

    setIsSaving(true);
    setSaveError(undefined);

    try {
      const repoCoord = `${REPO_KIND}:${repo.selectedMaintainer}:${repo.dTag}`;

      if (announcementFieldsChanged) {
        const npub = nip19.npubEncode(account.pubkey);
        const encodedId = encodeURIComponent(repo.dTag);

        // Build clone URLs: Grasp URLs + other git servers
        const graspCloneUrls = selectedDomains.map(
          (domain) => `https://${domain}/${npub}/${encodedId}.git`,
        );
        const allCloneUrls = [...graspCloneUrls, ...otherGitServers];

        // Build relay URLs: Grasp relay WSS + other relays
        const graspRelayUrls = selectedDomains.map(
          (domain) => `wss://${domain}`,
        );
        const allRelayUrls = [...graspRelayUrls, ...otherRelays];

        // Match ngit init behavior: seed maintainers with the selected maintainer
        // (self), then append any co-maintainers listed in this form.
        const maintainersTagValues = Array.from(
          new Set([repo.selectedMaintainer, ...editedMaintainers]),
        );

        const template: EventTemplate = {
          kind: REPO_KIND,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", repo.dTag],
            ["name", name.trim()],
            ["description", description.trim()],
            ...(allCloneUrls.length > 0
              ? [["clone", ...allCloneUrls] as string[]]
              : []),
            ...(allRelayUrls.length > 0
              ? [["relays", ...allRelayUrls] as string[]]
              : []),
            ["alt", `git repository: ${name.trim()}`],
            ...(eucHash.trim()
              ? [["r", eucHash.trim(), "euc"] as string[]]
              : []),
            ...(maintainersTagValues.length > 0
              ? [["maintainers", ...maintainersTagValues] as string[]]
              : []),
            ...webUrls.map((u) => ["web", u] as string[]),
            ...topics.map((t) => ["t", t] as string[]),
            ...repoUpstreamsToTags(effectiveUpstreams),
            // Preserve unknown/custom tags verbatim
            ...unknownTags.filter((tag) => tag.length > 0 && tag[0]),
          ],
        };

        const signedEvent = await account.signer.signEvent(template);

        // Publish to user outbox + repo's declared relays + git index
        await publish(signedEvent, [repoCoord, "git-index"]);
      }

      if (defaultBranchChanged && repoState) {
        const newHeadValue = `ref: refs/heads/${selectedBranch}`;
        const hasHead = repoState.event.tags.some(
          ([tagName]) => tagName === "HEAD",
        );
        const tags = hasHead
          ? repoState.event.tags.map((tag) =>
              tag[0] === "HEAD" ? ["HEAD", newHeadValue] : tag,
            )
          : [...repoState.event.tags, ["HEAD", newHeadValue]];

        const template: EventTemplate = {
          kind: REPO_STATE_KIND,
          content: repoState.event.content,
          created_at: Math.floor(Date.now() / 1000),
          tags,
        };

        const signedEvent = await account.signer.signEvent(template);
        await publish(signedEvent, [repoCoord]);
      }

      // Navigate back to the about page
      navigate(`${basePath}/about`);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    account,
    selectedAnnouncement,
    announcementFieldsChanged,
    defaultBranchChanged,
    repo,
    repoState,
    selectedDomains,
    otherGitServers,
    otherRelays,
    name,
    description,
    webUrls,
    topics,
    effectiveUpstreams,
    editedMaintainers,
    eucHash,
    unknownTags,
    selectedBranch,
    basePath,
    navigate,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      <div className="max-w-2xl">
        {/* Back link */}
        <Link
          to={`${basePath}/about`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to About
        </Link>

        <h1 className="text-xl font-semibold mb-6">{title}</h1>

        <div className="space-y-8">
          {/* ── Basic info ─────────────────────────────────────────────── */}
          <section className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Repository name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of the project"
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Website */}
            <div className="space-y-2">
              <Label>Website</Label>
              {webUrls.length > 0 && (
                <div className="space-y-1.5">
                  {webUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                    >
                      <span className="text-sm text-foreground/80 flex-1 truncate">
                        {url}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setWebUrls((prev) => prev.filter((u) => u !== url))
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Remove ${url}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com"
                  value={webInput}
                  onChange={(e) => setWebInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddWebUrl();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddWebUrl}
                  className="h-8 px-2.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Topics */}
            <div className="space-y-2">
              <Label>Topics</Label>
              {topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {topics.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-xs gap-1 pr-1"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() =>
                          setTopics((prev) => prev.filter((x) => x !== t))
                        }
                        className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                        aria-label={`Remove ${t}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add topic…"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTopic();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTopic}
                  className="h-8 px-2.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Earliest unique commit */}
            <div className="space-y-2">
              <Label htmlFor="edit-euc">Earliest unique commit</Label>
              <Input
                id="edit-euc"
                value={eucHash}
                onChange={(e) => setEucHash(e.target.value)}
                placeholder="40-character git commit hash"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                The earliest commit hash that uniquely identifies this
                repository — used to track it across forks and renames. Set
                automatically by <code className="font-mono">ngit push</code>.
              </p>
            </div>

            {/* Subordinate fork upstreams */}
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
                        focusSubordinateForkInput();
                        return;
                      }

                      setSubordinateForkEditorOpen(false);
                      setSubordinateForkInputBlurred(false);
                      setUpstream(emptyRepoUpstream());
                      setPendingUpstreamNip05(undefined);
                      setUpstreamInput("");
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
                        setSubordinateForkEditorOpen(false);
                        setSubordinateForkInputBlurred(false);
                        setUpstream(emptyRepoUpstream());
                        setPendingUpstreamNip05(undefined);
                        setUpstreamInput("");
                      }}
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                ) : null}
              </div>

              {subordinateForkEditorOpen && !identifiedNostrUpstream ? (
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Repository link or git URL
                    </Label>
                    <Input
                      ref={upstreamInputRef}
                      value={upstreamInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        const parsed = parseUpstreamInput(value);
                        const nextUpstream = parsed.upstream;
                        setUpstreamInput(value);
                        setUpstream(nextUpstream);
                        setPendingUpstreamNip05(
                          parsed.pendingNip05
                            ? {
                                ...parsed.pendingNip05,
                                gitUrl: nextUpstream.gitUrl ?? "",
                              }
                            : undefined,
                        );
                        if (
                          isValidRepoUpstream(nextUpstream) &&
                          !isRepoUpstreamSelfReference(
                            nextUpstream,
                            repo.selectedMaintainer,
                            repo.dTag,
                            editedCloneUrls,
                          )
                        ) {
                          setSubordinateForkInputBlurred(false);
                        }
                      }}
                      onBlur={() => setSubordinateForkInputBlurred(true)}
                      placeholder='"nostr://..." or "https://github.com/org/repo.git"'
                      aria-invalid={showInvalidSubordinateForkInput}
                      className={cn(
                        "h-8 text-xs font-mono",
                        showInvalidSubordinateForkInput &&
                          "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    {showInvalidSubordinateForkInput ? (
                      <p className="text-[11px] font-medium text-destructive">
                        {upstreamInputErrorMessage}
                      </p>
                    ) : isResolvingUpstreamNip05 && pendingUpstreamNip05 ? (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Resolving{" "}
                        <code className="font-mono">
                          {pendingUpstreamNip05.nip05}
                        </code>
                        …
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Also accepts <code className="font-mono">naddr1…</code>,{" "}
                        <code className="font-mono">nostr://npub1…/repo</code>,{" "}
                        <code className="font-mono">
                          nostr://nip05/relay/repo
                        </code>
                        , <code className="font-mono">gitworkshop.dev</code>{" "}
                        repo URLs,{" "}
                        <code className="font-mono">npub1…/repo</code>, and
                        repository coordinates. The checkbox checks itself when
                        a valid reference is detected.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUpstream(emptyRepoUpstream());
                        setPendingUpstreamNip05(undefined);
                        setUpstreamInput("");
                        setSubordinateForkInputBlurred(false);
                      }}
                      className="h-7 px-2 text-xs text-muted-foreground"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <Separator />

          {/* ── Default branch ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Default branch</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The default branch is used as the repository HEAD, shown first
                in the code view, and used as the base for pull requests. This
                setting updates only the kind:30618 repository state event.
              </p>
            </div>

            {!repoState ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    No state event found for this repository. Push your
                    repository via <code className="font-mono">ngit push</code>{" "}
                    to create one, then return here to set the default branch.
                  </p>
                </div>
              </div>
            ) : branches.length === 0 ? (
              <div className="rounded-lg border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                No branches found in the repository state event.
              </div>
            ) : (
              <div className="space-y-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="default-branch"
                      variant="outline"
                      className="w-full max-w-xs justify-between font-mono text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {selectedBranch || "Select branch…"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
                    {branches.map((branch) => (
                      <DropdownMenuItem
                        key={branch}
                        onSelect={() => {
                          setSelectedBranch(branch);
                          setUserHasSelectedBranch(
                            branch !== currentHeadBranch,
                          );
                        }}
                        className="flex items-center justify-between font-mono text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {branch}
                        </span>
                        {branch === currentHeadBranch && (
                          <span className="text-xs text-muted-foreground ml-2">
                            current
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {currentHeadBranch && (
                  <p className="text-xs text-muted-foreground">
                    Current default branch:{" "}
                    <code className="font-mono bg-muted px-1 py-0.5 rounded">
                      {currentHeadBranch}
                    </code>
                  </p>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* ── Maintainers ─────────────────────────────────────────────── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Maintainers
              </h2>
              {isMultiMaintainer ? (
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  You are editing only your selected announcement.
                  Co-maintainers become confirmed when the recursive maintainer
                  chain resolves them through reciprocal listings.
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {isMultiMaintainer ? "Confirmed maintainers" : "Maintainer"}
                </p>
                {isMultiMaintainer ? (
                  <p className="text-xs text-muted-foreground/80 mt-0.5">
                    Resolved from the current recursive maintainer graph.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                {repo.maintainerSet.map((pubkey) => {
                  const listedBy = maintainerListers.get(pubkey) ?? [];
                  const isLead = maintainerLeadership.leadMaintainer === pubkey;
                  return (
                    <div
                      key={pubkey}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/60 px-2.5 py-2"
                    >
                      <UserLink
                        pubkey={pubkey}
                        avatarSize="sm"
                        nameClassName="text-sm whitespace-nowrap"
                        className="min-w-fit flex-1"
                      />
                      {isMultiMaintainer ? (
                        <MaintainerListedBy pubkeys={listedBy} />
                      ) : null}
                      {isLead && <LeadBadge />}
                    </div>
                  );
                })}
              </div>

              {isMultiMaintainer ? (
                <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 text-xs">
                  {maintainerLeadership.leadMaintainer ? (
                    <LeadMaintainerSummary
                      hasLead
                      className="text-muted-foreground"
                    >
                      <UserName
                        pubkey={maintainerLeadership.leadMaintainer}
                        className="text-xs text-foreground"
                        linkToProfile
                      />
                    </LeadMaintainerSummary>
                  ) : (
                    <LeadMaintainerSummary
                      hasLead={false}
                      className="text-muted-foreground"
                    />
                  )}
                </div>
              ) : null}

              {requestedMaintainers.length > 0 && (
                <div className="space-y-2 border-t border-border/50 pt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invited / unconfirmed
                  </p>
                  <div className="space-y-1.5">
                    {requestedMaintainers.map((pubkey) => {
                      const listedBy =
                        requestedMaintainerListers.get(pubkey) ?? [];
                      return (
                        <div
                          key={pubkey}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed border-border/60 bg-muted/10 px-2.5 py-1.5"
                        >
                          <UserLink
                            pubkey={pubkey}
                            avatarSize="xs"
                            nameClassName="text-xs text-muted-foreground whitespace-nowrap"
                            className="min-w-fit flex-1"
                          />
                          <MaintainerListedBy pubkeys={listedBy} />
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[10px] text-muted-foreground"
                          >
                            unconfirmed
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <Label>
                  {isMultiMaintainer
                    ? "Co-maintainers you have listed"
                    : "Add co-maintainers"}
                </Label>
                {isMultiMaintainer ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    These are saved as the co-maintainers you list for this
                    repo. Your own pubkey is included automatically.
                  </p>
                ) : null}
              </div>

              {editedMaintainers.length > 0 ? (
                <div className="space-y-1.5">
                  {editedMaintainers.map((pubkey) => (
                    <div
                      key={pubkey}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                    >
                      <UserLink
                        pubkey={pubkey}
                        avatarSize="xs"
                        nameClassName="text-sm"
                        className="min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveMaintainer(pubkey)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        aria-label={`Remove maintainer ${pubkey}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
                  You have not listed any co-maintainers.
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <MaintainerUserInput
                    placeholder="@name, npub1…, or hex pubkey"
                    value={maintainerInput}
                    onValueChange={(value) => {
                      setMaintainerInput(value);
                      setMaintainerInputError(undefined);
                    }}
                    onAdd={handleAddMaintainer}
                    onSelectPubkey={addMaintainerPubkey}
                    priorityPubkeys={maintainerPickerPriorityPubkeys}
                    excludePubkeys={maintainerPickerExcludePubkeys}
                    className="h-8 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddMaintainer}
                    className="h-8 px-2.5 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {maintainerInputError && (
                  <p className="text-xs text-red-500 px-0.5">
                    {maintainerInputError}
                  </p>
                )}
              </div>
            </div>
          </section>

          <Separator />

          {/* ── Infrastructure ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Infrastructure</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Grasp servers provide git hosting and Nostr relay in one.
                Alternatively, specify both a relay and a git server manually.
              </p>
            </div>

            {/* Grasp servers — always visible, primary path */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 px-1">
                <GraspLogo className="h-3.5 w-3.5 text-pink-500" />
                <span className="text-sm font-medium">Grasp servers</span>
              </div>

              <div className="space-y-3 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Grasp servers host your git data and act as relays. Clone and
                  relay URLs are auto-generated from your server selection.
                  Adding a new server requires pushing via{" "}
                  <code className="font-mono">ngit</code> afterwards.
                </p>

                {/* Server checklist */}
                <div className="space-y-1.5">
                  {allKnownDomains.map((domain) => {
                    const checked = selectedDomains.includes(domain);
                    const isDefault = DEFAULT_GRASP_SERVERS.includes(domain);
                    const isUserList =
                      isFromUserList &&
                      resolvedServers.some((s) => s.domain === domain);
                    const isFromAnnouncement =
                      currentGraspDomains.includes(domain);
                    return (
                      <label
                        key={domain}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => handleToggleServer(domain)}
                          id={`edit-server-${domain}`}
                        />
                        <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-mono flex-1">
                          {domain}
                        </span>
                        {isFromAnnouncement && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 text-pink-500 border-pink-500/30"
                          >
                            current
                          </Badge>
                        )}
                        {isUserList && !isDefault && !isFromAnnouncement && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            your list
                          </Badge>
                        )}
                        {isDefault && !isFromAnnouncement && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
                          >
                            default
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Add custom server */}
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="relay.example.com"
                      value={customDomain}
                      disabled={validatingDomain}
                      onChange={(e) => {
                        setCustomDomain(e.target.value);
                        setCustomDomainError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddCustomDomain();
                        }
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleAddCustomDomain()}
                      disabled={validatingDomain}
                      className="h-8 px-2.5 shrink-0"
                    >
                      {validatingDomain ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {customDomainError && (
                    <p className="text-xs text-red-500 px-0.5">
                      {customDomainError}
                    </p>
                  )}
                </div>

                {!hasInfrastructure && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 px-0.5">
                    Select at least one Grasp server, or add both a relay and a
                    git server below.
                  </p>
                )}

                {/* Union Grasp servers from other maintainers */}
                {unionOnlyGraspDomains.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyGraspDomains.map(
                      ({ domain, contributorPubkey }) => (
                        <UnionItem
                          key={domain}
                          value={domain}
                          contributorPubkey={contributorPubkey}
                          monospace
                        />
                      ),
                    )}
                  </UnionSection>
                )}
              </div>
            </div>

            {/* Other relays — optional, collapsed by default */}
            <Collapsible
              open={otherRelaysOpen}
              onOpenChange={setOtherRelaysOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {otherRelaysOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Radio className="h-3 w-3" />
                    <span className="font-medium">Other relays</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (optional)
                    </span>
                  </span>
                  {!otherRelaysOpen && otherRelays.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {otherRelays.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Additional Nostr relay URLs beyond Grasp servers.
                </p>

                {otherRelays.length > 0 && (
                  <div className="space-y-1.5">
                    {otherRelays.map((url) => (
                      <div
                        key={url}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                      >
                        <code className="text-xs font-mono text-foreground/80 flex-1 truncate">
                          {url}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleRemoveRelay(url)}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`Remove ${url}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="wss://relay.example.com"
                      value={relayInput}
                      onChange={(e) => {
                        setRelayInput(e.target.value);
                        setRelayInputError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddRelay();
                        }
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddRelay}
                      className="h-8 px-2.5 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {relayInputError && (
                    <p className="text-xs text-red-500 px-0.5">
                      {relayInputError}
                    </p>
                  )}
                </div>

                {/* Union relays from other maintainers */}
                {unionOnlyRelays.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyRelays.map(({ url, contributorPubkey }) => (
                      <UnionItem
                        key={url}
                        value={url}
                        contributorPubkey={contributorPubkey}
                        monospace
                      />
                    ))}
                  </UnionSection>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Other git servers — optional, collapsed by default */}
            <Collapsible
              open={otherGitServersOpen}
              onOpenChange={setOtherGitServersOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {otherGitServersOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <GitBranch className="h-3 w-3" />
                    <span className="font-medium">Other git servers</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (optional)
                    </span>
                  </span>
                  {!otherGitServersOpen && otherGitServers.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {otherGitServers.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Additional raw git clone URLs beyond Grasp servers (e.g.
                  GitHub mirrors).
                </p>

                {otherGitServers.length > 0 && (
                  <div className="space-y-1.5">
                    {otherGitServers.map((url) => (
                      <div
                        key={url}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5"
                      >
                        <code className="text-xs font-mono text-foreground/80 flex-1 truncate break-all">
                          {url}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleRemoveGitServer(url)}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label={`Remove ${url}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://github.com/user/repo.git"
                      value={gitServerInput}
                      onChange={(e) => {
                        setGitServerInput(e.target.value);
                        setGitServerInputError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGitServer();
                        }
                      }}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddGitServer}
                      className="h-8 px-2.5 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {gitServerInputError && (
                    <p className="text-xs text-red-500 px-0.5">
                      {gitServerInputError}
                    </p>
                  )}
                </div>

                {/* Union git servers from other maintainers */}
                {unionOnlyGitServers.length > 0 && (
                  <UnionSection label="Covered by co-maintainers (read-only)">
                    {unionOnlyGitServers.map(({ url, contributorPubkey }) => (
                      <UnionItem
                        key={url}
                        value={url}
                        contributorPubkey={contributorPubkey}
                        monospace
                      />
                    ))}
                  </UnionSection>
                )}
              </CollapsibleContent>
            </Collapsible>
          </section>

          <Separator />

          {/* ── Unknown / custom tags ──────────────────────────────────── */}
          <section className="space-y-3">
            <Collapsible
              open={unknownTagsOpen}
              onOpenChange={setUnknownTagsOpen}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    {unknownTagsOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Tag className="h-3 w-3" />
                    <span className="font-medium">Custom tags</span>
                    <span className="font-normal opacity-60 ml-0.5">
                      (advanced)
                    </span>
                  </span>
                  {!unknownTagsOpen && unknownTags.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4 px-1.5"
                    >
                      {unknownTags.length}
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-3 pt-2 pl-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tags not recognised by this client are preserved here. Both
                  the tag name and values are editable. Use "add value" to
                  attach additional values to the same tag.
                </p>

                {unknownTags.length > 0 && (
                  <div className="space-y-2">
                    {unknownTags.map((tag, idx) => (
                      <UnknownTagRow
                        key={idx}
                        tag={tag}
                        onChange={(updated) =>
                          setUnknownTags((prev) =>
                            prev.map((t, i) => (i === idx ? updated : t)),
                          )
                        }
                        onRemove={() =>
                          setUnknownTags((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                <AddCustomTagRow
                  onAdd={(tag) => setUnknownTags((prev) => [...prev, tag])}
                />
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* ── Error / actions ────────────────────────────────────────── */}
          {saveError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="bg-pink-600 hover:bg-pink-700 text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button asChild variant="ghost">
              <Link to={`${basePath}/about`}>Cancel</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MaintainerUserInput — single-line user finder for co-maintainers
// ---------------------------------------------------------------------------

function MaintainerUserInput({
  value,
  onValueChange,
  onAdd,
  onSelectPubkey,
  priorityPubkeys,
  excludePubkeys,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onSelectPubkey: (pubkey: string) => void;
  priorityPubkeys: string[];
  excludePubkeys: string[];
  placeholder?: string;
  className?: string;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [activeDescendantId, setActiveDescendantId] = useState<
    string | undefined
  >();
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const raw = value.trim();
  const searchQuery = raw.startsWith("@") ? raw.slice(1) : raw;
  const shouldSearch =
    isFocused && raw.length > 0 && !looksLikeDirectPubkeyInput(raw);

  const updateDropdownPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: Math.max(0, Math.min(rect.left, window.innerWidth - 280)),
    });
  }, []);

  useEffect(() => {
    if (!shouldSearch) return;
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    return () => window.removeEventListener("resize", updateDropdownPosition);
  }, [shouldSearch, updateDropdownPosition]);

  const handleSelectPubkey = useCallback(
    (pubkey: string) => {
      onSelectPubkey(pubkey);

      // UserAutocompleteDropdown closes itself after selection. Restore both
      // DOM focus and our focus state on the next frame so the user can keep
      // typing another maintainer name and immediately get suggestions.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        setIsFocused(true);
        updateDropdownPosition();
      });
    },
    [onSelectPubkey, updateDropdownPosition],
  );

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          updateDropdownPosition();
        }}
        onFocus={() => {
          setIsFocused(true);
          updateDropdownPosition();
        }}
        onBlur={() => setIsFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !shouldSearch) {
            e.preventDefault();
            onAdd();
          }
        }}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={shouldSearch}
        aria-controls={shouldSearch ? listboxId : undefined}
        aria-activedescendant={
          shouldSearch && activeDescendantId ? activeDescendantId : undefined
        }
        className={className}
      />
      <UserAutocompleteDropdown
        query={searchQuery}
        isOpen={shouldSearch}
        position={dropdownPos}
        onSelectPubkey={handleSelectPubkey}
        onClose={() => setIsFocused(false)}
        keyboardTargetRef={inputRef}
        priorityPubkeys={priorityPubkeys}
        excludePubkeys={excludePubkeys}
        listboxId={listboxId}
        onActiveDescendantChange={setActiveDescendantId}
      />
    </div>
  );
}

function computeMaintainerListers(
  listedPubkeys: string[],
  listerPubkeys: string[],
  maintainerEdges: ResolvedRepo["maintainerEdges"],
): Map<string, string[]> {
  const listed = new Set(listedPubkeys);
  const listers = new Set(listerPubkeys);
  const listerOrder = new Map(
    listerPubkeys.map((pubkey, index) => [pubkey, index]),
  );
  const listedByPubkey = new Map<string, string[]>();
  const seenEdges = new Set<string>();

  for (const pubkey of listedPubkeys) listedByPubkey.set(pubkey, []);

  for (const { from, to } of maintainerEdges) {
    if (!listers.has(from) || !listed.has(to)) continue;
    if (from === to) continue;

    const edgeKey = `${from}:${to}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);

    listedByPubkey.get(to)?.push(from);
  }

  for (const listedBy of listedByPubkey.values()) {
    listedBy.sort(
      (a, b) => (listerOrder.get(a) ?? 0) - (listerOrder.get(b) ?? 0),
    );
  }

  return listedByPubkey;
}

function MaintainerListedBy({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) {
    return (
      <span className="shrink-0 text-[11px] text-muted-foreground">
        Not listed yet
      </span>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full shrink items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="shrink-0">Listed by</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {pubkeys.map((pubkey) => (
          <span key={pubkey} className="inline-flex min-w-0 items-center gap-1">
            <UserAvatar pubkey={pubkey} size="xs" linkToProfile />
            <UserName
              pubkey={pubkey}
              className="hidden max-w-24 truncate text-[11px] text-foreground md:inline-block"
              linkToProfile
            />
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnknownTagRow — editable row for a single unknown/custom tag
// ---------------------------------------------------------------------------

/**
 * Two-column layout:
 *   left  — editable tag name input (fixed width)
 *   right — stacked value inputs, one per line, with per-value × and an
 *           "add value" + button below the last one
 *
 * The outer × (top-right) removes the entire tag.
 */
function UnknownTagRow({
  tag,
  onChange,
  onRemove,
}: {
  tag: string[];
  onChange: (updated: string[]) => void;
  onRemove: () => void;
}) {
  const [name, ...rawValues] = tag;
  // Always show at least one value input
  const values = rawValues.length > 0 ? rawValues : [""];

  const handleNameChange = (newName: string) => {
    onChange([newName, ...values]);
  };

  const handleValueChange = (valueIdx: number, newVal: string) => {
    const newValues = values.map((v, i) => (i === valueIdx ? newVal : v));
    onChange([name, ...newValues]);
  };

  const handleRemoveValue = (valueIdx: number) => {
    const newValues = values.filter((_, i) => i !== valueIdx);
    // Keep at least one empty value so the input is always visible
    onChange([name, ...(newValues.length > 0 ? newValues : [""])]);
  };

  const handleAddValue = () => {
    onChange([name, ...values, ""]);
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex items-start gap-2">
        {/* Left column — tag name */}
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="h-7 w-24 shrink-0 text-xs font-mono"
          placeholder="name"
          aria-label="Tag name"
        />

        {/* Right column — value inputs stacked */}
        <div className="flex-1 space-y-1">
          {values.map((val, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={val}
                onChange={(e) => handleValueChange(i, e.target.value)}
                className="h-7 text-xs font-mono flex-1"
                placeholder="value"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveValue(i)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="Remove value"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {/* Add another value */}
          <button
            type="button"
            onClick={handleAddValue}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
            aria-label="Add value"
          >
            <Plus className="h-3 w-3" />
            <span>add value</span>
          </button>
        </div>

        {/* Remove whole tag */}
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-1"
          aria-label={`Remove tag ${name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddCustomTagRow — form for adding a brand-new custom tag
// ---------------------------------------------------------------------------

/**
 * Same two-column layout as UnknownTagRow. Manages its own pending name +
 * values list before committing, so the "add value" button is visible from
 * the start and makes the multi-value capability obvious.
 */
function AddCustomTagRow({ onAdd }: { onAdd: (tag: string[]) => void }) {
  const [tagName, setTagName] = useState("");
  const [values, setValues] = useState<string[]>([""]);
  const [error, setError] = useState<string | undefined>();

  const handleCommit = () => {
    const name = tagName.trim();
    if (!name) {
      setError("Tag name is required");
      return;
    }
    if (KNOWN_TAG_NAMES.has(name)) {
      setError(`"${name}" is managed by the form above`);
      return;
    }
    onAdd([name, ...values]);
    setTagName("");
    setValues([""]);
    setError(undefined);
  };

  const handleValueChange = (i: number, val: string) => {
    setValues((prev) => prev.map((v, idx) => (idx === i ? val : v)));
  };

  const handleRemoveValue = (i: number) => {
    setValues((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length > 0 ? next : [""];
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {/* Left — tag name */}
        <Input
          placeholder="tag name"
          value={tagName}
          onChange={(e) => {
            setTagName(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCommit();
            }
          }}
          className="h-7 w-24 shrink-0 text-xs font-mono"
        />

        {/* Right — values */}
        <div className="flex-1 space-y-1">
          {values.map((val, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                placeholder="value"
                value={val}
                onChange={(e) => handleValueChange(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                className="h-7 text-xs font-mono flex-1"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveValue(i)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="Remove value"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setValues((prev) => [...prev, ""])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
          >
            <Plus className="h-3 w-3" />
            <span>add value</span>
          </button>
        </div>

        {/* Commit */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCommit}
          className="h-7 px-2.5 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-red-500 px-0.5">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnionSection — collapsible section for union-only items from co-maintainers
// ---------------------------------------------------------------------------

function UnionSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Users className="h-3 w-3" />
          {label}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pt-2">
        <p className="text-xs text-muted-foreground/70 leading-relaxed px-1 pb-1">
          These are contributed by co-maintainers' announcements and are
          included via union. They are not in your announcement.
        </p>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// UnionItem — a single read-only item with contributor attribution
// ---------------------------------------------------------------------------

function UnionItem({
  value,
  contributorPubkey,
  monospace = false,
}: {
  value: string;
  contributorPubkey: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-1.5 opacity-75">
      <span
        className={cn(
          "text-xs text-foreground/60 flex-1 truncate",
          monospace && "font-mono",
        )}
      >
        {value}
      </span>
      {contributorPubkey && (
        <span className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-1">
          via{" "}
          <UserName
            pubkey={contributorPubkey}
            className="text-[10px] text-muted-foreground/60"
          />
        </span>
      )}
    </div>
  );
}
