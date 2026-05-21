import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Check,
  AlertTriangle,
  Radio,
  Server,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Copy,
  ChevronDown,
} from "lucide-react";
import { deriveEffectiveSource } from "@/lib/sourceUtils";
import { useMobilePopoverFullWidth } from "@/hooks/useMobilePopoverFullWidth";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { formatDistanceStrict } from "date-fns";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import type { RepositoryState } from "@/casts/RepositoryState";
import type {
  PoolWarning,
  UrlState,
  UrlRefStatus,
  UrlErrorKind,
} from "@/lib/git-grasp-pool/types";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import { GraspLogo } from "@/components/GraspLogo";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { graspCloneUrlNpub } from "@/lib/nip34";
import { findOlderStateEvent } from "@/lib/refStatus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the hostname from a URL string, falling back to the raw URL. */
// eslint-disable-next-line react-refresh/only-export-components
export function gitServerDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Short hostname + path label from a clone URL, e.g. "github.com/foo/bar".
 * Useful for compact source-label rendering in dropdowns and chips.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shortServerLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
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

function npubToPubkey(npub: string): string | undefined {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProxyBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 cursor-default leading-none">
          proxy
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        className="text-xs max-w-[220px]"
        sideOffset={6}
      >
        Fetched via cors.isomorphic-git.org — this server does not support
        cross-origin requests
      </TooltipContent>
    </Tooltip>
  );
}

function ErrorDetail({
  errorKind,
  usesProxy,
}: {
  errorKind?: UrlErrorKind | null;
  usesProxy: boolean;
}) {
  let message: string;
  switch (errorKind) {
    case "not-http":
      message = "SSH/non-HTTP URL — not fetchable in browser";
      break;
    case "not-git":
      message = usesProxy
        ? "no git data via proxy — wrong path or 404"
        : "no git data — wrong path or 404";
      break;
    case "cors-blocked":
      message = "CORS blocked — direct and proxy both failed";
      break;
    case "proxy-error":
      message = "proxy error — server unreachable via proxy";
      break;
    case "http-error":
      message = "HTTP error — server returned 4xx/5xx";
      break;
    case "network":
      message = "network error — server unreachable";
      break;
    case "transient":
      message = "temporarily unreachable";
      break;
    default:
      message = "unreachable";
  }
  return (
    <p className="text-[11px] text-muted-foreground/80 mt-0.5">{message}</p>
  );
}

/** Status dot for a server row in the source selector */
function SourceServerDot({
  status,
  gitIsAhead,
  serverHasOlderState,
}: {
  status: UrlRefStatus;
  gitIsAhead?: boolean;
  serverHasOlderState?: boolean;
}) {
  if (status === "behind" && gitIsAhead) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
  if (status === "behind" && serverHasOlderState) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-sky-500 shrink-0" />;
  }
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "behind":
      return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "ahead":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "error":
      return (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      );
    case "connected":
    case "unknown":
      return (
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
      );
  }
}

/** One-word right-aligned status label for a server row */
function SourceServerLabel({
  status,
  hasState,
  gitIsAhead,
  serverHasOlderState,
}: {
  status: UrlRefStatus;
  hasState: boolean;
  gitIsAhead?: boolean;
  serverHasOlderState?: boolean;
}) {
  if (gitIsAhead && hasState) {
    switch (status) {
      case "match":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            Nostr state
          </span>
        );
      case "behind":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            ahead
          </span>
        );
      default:
        break;
    }
  }
  if (serverHasOlderState && status === "behind") {
    return (
      <span className="text-[10px] text-sky-600 dark:text-sky-400 shrink-0">
        old state
      </span>
    );
  }
  switch (status) {
    case "match":
      return (
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">
          {hasState ? "matches nostr" : "in sync"}
        </span>
      );
    case "behind":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          differs
        </span>
      );
    case "ahead":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          ahead
        </span>
      );
    case "error":
      return (
        <span className="text-[10px] text-muted-foreground/60 shrink-0">
          error
        </span>
      );
    case "connected":
      return (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">
          checking…
        </span>
      );
    case "unknown":
      return (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">…</span>
      );
  }
}

/**
 * A single git server row in the source selector dropdown.
 * Clicking selects it as the verification source (if selectable).
 */
function SourceServerRow({
  url,
  urlState,
  isGrasp,
  isSelected,
  hasState,
  gitIsAhead,
  stateCreatedAt,
  gitCommitterDate,
  pool,
  onSelect,
  olderStateEvent,
  currentRefFullName,
  currentRefIsDefault,
  currentRefInNostrState,
}: {
  url: string;
  urlState: UrlState | undefined;
  isGrasp: boolean;
  isSelected: boolean;
  hasState: boolean;
  gitIsAhead: boolean;
  stateCreatedAt?: number;
  gitCommitterDate?: number;
  pool?: GitGraspPool | null;
  onSelect: () => void;
  /** When set, this server's relay served an older (but valid) signed state event */
  olderStateEvent?: NostrEvent;
  /** Full ref name of the currently viewed ref (e.g. "refs/heads/feature-x") */
  currentRefFullName?: string;
  /** True when the current ref is the default branch */
  currentRefIsDefault?: boolean;
  /** True when the nostr state includes the current ref, false when it doesn't, undefined when unknown */
  currentRefInNostrState?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [serverCommitTs, setServerCommitTs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const connectionStatus = urlState?.status ?? "untested";
  const hasInfoRefs = !!urlState?.infoRefs;
  const isError =
    connectionStatus === "permanent-failure" || connectionStatus === "error";
  const isLoading = !isError && !hasInfoRefs;
  const isSelectable = hasInfoRefs && !isError;

  // For the server row we show overall connection health, not per-ref status
  // (per-ref status is shown in the ref list itself once selected)
  const overallStatus: UrlRefStatus = isError
    ? "error"
    : isLoading
      ? "unknown"
      : (() => {
          if (!urlState) return "unknown";
          const statuses = Object.values(urlState.refStatus);
          if (statuses.length === 0) return "connected";
          if (statuses.some((s) => s === "behind" || s === "ahead")) {
            return gitIsAhead ? "behind" : "behind";
          }
          if (
            statuses.every(
              (s) => s === "match" || s === "error" || s === "connected",
            )
          ) {
            if (statuses.some((s) => s === "match")) return "match";
          }
          return "connected";
        })();

  const needsTimestampCheck =
    overallStatus === "behind" &&
    hasState &&
    !gitIsAhead &&
    !!pool &&
    stateCreatedAt !== undefined;

  useEffect(() => {
    if (!needsTimestampCheck || !urlState) return;
    // Find any differing commit to check its timestamp
    const differingEntry = Object.entries(urlState.refCommits).find(
      ([refName]) => {
        const s = urlState.refStatus[refName];
        return s === "behind" || s === "ahead";
      },
    );
    if (!differingEntry) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    pool!
      .getSingleCommit(differingEntry[1], ac.signal)
      .then((commit) => {
        if (ac.signal.aborted || !commit) return;
        setServerCommitTs(
          commit.committer?.timestamp ?? commit.author.timestamp,
        );
      })
      .catch(() => {});

    return () => ac.abort();
  }, [needsTimestampCheck, urlState, pool]);

  const refinedBehindLabel: "behind nostr" | "diverged" | "differs" =
    !needsTimestampCheck
      ? "differs"
      : serverCommitTs === null
        ? "differs"
        : serverCommitTs < stateCreatedAt!
          ? "behind nostr"
          : "diverged";

  // Whether the current ref exists on this server (only meaningful once infoRefs loaded)
  const currentRefOnServer = useMemo(() => {
    if (!currentRefFullName || !urlState?.infoRefs) return undefined; // unknown
    return (
      urlState.infoRefs.refs[currentRefFullName] !== undefined ||
      urlState.infoRefs.refs[`${currentRefFullName}^{}`] !== undefined
    );
  }, [currentRefFullName, urlState?.infoRefs]);

  // Per-ref status for the current ref on this server
  const currentRefStatus = currentRefFullName
    ? urlState?.refStatus[currentRefFullName]
    : undefined;

  // Whether the current ref is ahead of nostr on this server:
  // - pool says "ahead" or "behind" with gitIsAhead (server is ahead of state)
  // - OR: server has the ref but nostr state doesn't (git-server-only branch)
  const currentRefIsAhead =
    currentRefStatus === "ahead" ||
    (currentRefStatus === "behind" && gitIsAhead) ||
    (currentRefOnServer === true && currentRefInNostrState === false);

  // Commit timestamp for the current ref on this server (for "ahead" messages)
  const [currentRefCommitTs, setCurrentRefCommitTs] = useState<number | null>(
    null,
  );
  const currentRefAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (
      !currentRefFullName ||
      !currentRefOnServer ||
      !pool ||
      !urlState?.infoRefs
    )
      return;
    const commit =
      urlState.infoRefs.refs[`${currentRefFullName}^{}`] ??
      urlState.infoRefs.refs[currentRefFullName];
    if (!commit) return;

    currentRefAbortRef.current?.abort();
    const ac = new AbortController();
    currentRefAbortRef.current = ac;

    pool
      .getSingleCommit(commit, ac.signal)
      .then((c) => {
        if (ac.signal.aborted || !c) return;
        setCurrentRefCommitTs(c.committer?.timestamp ?? c.author.timestamp);
      })
      .catch(() => {});

    return () => ac.abort();
  }, [currentRefFullName, currentRefOnServer, pool, urlState?.infoRefs]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const npub = isGrasp ? (graspCloneUrlNpub(url) ?? undefined) : undefined;
  const pubkey = npub ? npubToPubkey(npub) : undefined;
  const displayUrl = isGrasp ? condenseGraspUrl(url) : url;

  const serverIsUnsignedAhead =
    overallStatus === "behind" && hasState && gitIsAhead;
  const serverIsSignedOnly =
    overallStatus === "match" && hasState && gitIsAhead;
  // Server has an older signed state — it's behind the canonical state but
  // its data is still cryptographically verified (just not the latest).
  const serverHasOlderState =
    overallStatus === "behind" && hasState && !gitIsAhead && !!olderStateEvent;

  // Highlight color for selected state
  const selectedHighlight = isSelected
    ? gitIsAhead
      ? ("amber" as const)
      : serverHasOlderState
        ? ("sky" as const)
        : ("emerald" as const)
    : null;

  return (
    <button
      onClick={isSelectable ? onSelect : undefined}
      disabled={!isSelectable}
      className={cn(
        "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors relative",
        isSelectable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
        selectedHighlight === "emerald" &&
          "bg-emerald-500/5 border-l-2 border-emerald-500 pl-[14px] hover:bg-emerald-500/10",
        selectedHighlight === "amber" &&
          "bg-amber-500/5 border-l-2 border-amber-500 pl-[14px] hover:bg-amber-500/10",
        selectedHighlight === "sky" &&
          "bg-sky-500/5 border-l-2 border-sky-500 pl-[14px] hover:bg-sky-500/10",
        !selectedHighlight && isSelectable && "hover:bg-accent/30",
      )}
    >
      <SourceServerDot
        status={overallStatus}
        gitIsAhead={gitIsAhead}
        serverHasOlderState={serverHasOlderState}
      />

      <div className="min-w-0 flex-1">
        {/* URL + identity bubble */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <p
            className={cn(
              "font-mono text-[10px] break-all leading-snug",
              isError ? "text-muted-foreground/60" : "text-foreground/80",
            )}
            title={url}
          >
            {displayUrl}
          </p>
          {isGrasp && (pubkey ?? npub) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border/60 bg-popover px-1.5 py-0.5 shadow-sm whitespace-nowrap font-sans leading-none shrink-0",
                isError && "opacity-60 grayscale",
              )}
            >
              {pubkey ? (
                <>
                  <UserAvatar
                    pubkey={pubkey}
                    size="xs"
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

        {/* Sub-line detail */}
        {/* When the current ref is not on this server, show a clear warning */}
        {currentRefOnServer === false && !currentRefIsDefault && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            doesn't have this ref — will show default branch
          </p>
        )}
        {serverIsUnsignedAhead && currentRefOnServer !== false && (
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
            {currentRefIsDefault || !currentRefFullName ? (
              <>
                commits not yet announced on Nostr
                {gitCommitterDate && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (
                    {safeFormatDistanceToNow(gitCommitterDate, {
                      addSuffix: true,
                    })}
                    )
                  </span>
                )}
              </>
            ) : currentRefIsAhead ? (
              <>
                this ref not yet announced on Nostr
                {currentRefCommitTs !== null && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (
                    {safeFormatDistanceToNow(currentRefCommitTs, {
                      addSuffix: true,
                    })}
                    )
                  </span>
                )}
              </>
            ) : (
              <>
                commits not yet announced on Nostr
                {gitCommitterDate && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    (
                    {safeFormatDistanceToNow(gitCommitterDate, {
                      addSuffix: true,
                    })}
                    )
                  </span>
                )}
              </>
            )}
          </p>
        )}
        {/* Server has the current ref but nostr state doesn't (git-server-only branch) */}
        {currentRefOnServer === true &&
          currentRefInNostrState === false &&
          !serverIsUnsignedAhead &&
          !serverIsSignedOnly && (
            <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
              this ref not yet announced on Nostr
              {currentRefCommitTs !== null && (
                <span className="text-muted-foreground/70">
                  {" "}
                  (
                  {safeFormatDistanceToNow(currentRefCommitTs, {
                    addSuffix: true,
                  })}
                  )
                </span>
              )}
            </p>
          )}
        {serverIsSignedOnly && currentRefOnServer !== false && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            {currentRefIsDefault || !currentRefFullName
              ? "serving Nostr state · another server has unannounced commits"
              : currentRefIsAhead
                ? "this ref not yet announced on Nostr"
                : "serving Nostr state · another server has unannounced commits"}
          </p>
        )}
        {overallStatus === "behind" &&
          !gitIsAhead &&
          !serverHasOlderState &&
          currentRefOnServer !== false && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {refinedBehindLabel === "behind nostr"
                ? "commit older than nostr state"
                : refinedBehindLabel === "diverged"
                  ? "commit diverged from nostr state"
                  : "differs from nostr state"}
            </p>
          )}
        {serverHasOlderState &&
          olderStateEvent &&
          currentRefOnServer !== false && (
            <p className="text-[11px] text-sky-600/80 dark:text-sky-400/70 mt-0.5">
              serving older Nostr state
              {" · "}
              {safeFormatDistanceToNow(olderStateEvent.created_at, {
                addSuffix: true,
              })}
            </p>
          )}
        {isError && (
          <ErrorDetail
            errorKind={urlState?.lastErrorKind}
            usesProxy={urlState?.usesProxy ?? false}
          />
        )}
        {isLoading && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            fetching…
          </p>
        )}
        {!isError && !isLoading && overallStatus === "connected" && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            reachable — waiting for state…
          </p>
        )}
      </div>

      {urlState?.usesProxy && <ProxyBadge />}

      {/* Copy URL icon — only on hover, stops propagation so it doesn't select */}
      {isSelectable && (
        <span
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground mt-0.5"
          onClick={handleCopy}
          aria-label="Copy URL"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </span>
      )}

      {/* Right-aligned status label */}
      <SourceServerLabel
        status={overallStatus}
        hasState={hasState}
        gitIsAhead={gitIsAhead}
        serverHasOlderState={serverHasOlderState}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SourceSelector — the main exported component
// ---------------------------------------------------------------------------

/**
 * Presentation mode for the surrounding container.
 *
 * - "popover-header": no border/padding wrapper — embeds cleanly inside a
 *   popover that already has its own border and rounding.
 * - "page-toolbar": adds a bordered, rounded, padded card so the selector
 *   stands on its own in a full-page toolbar.
 */
export type SourceSelectorPresentation = "popover-header" | "page-toolbar";

export interface SourceSelectorProps {
  selectedSource: string;
  onSelectSource: (source: string) => void;
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  stateCreatedAt?: number;
  urlStates: Record<string, UrlState>;
  cloneUrls: string[];
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  stateBehindGit: boolean;
  poolWarning?: PoolWarning | null;
  pool?: GitGraspPool | null;
  relayStateMap?: Map<string, NostrEvent>;
  /** Full ref name of the currently viewed ref (e.g. "refs/heads/feature-x") */
  currentRefFullName?: string;
  /** True when the current ref is the default branch */
  currentRefIsDefault?: boolean;
  /**
   * Called when the user selects a source that doesn't have the current ref.
   * Receives the new source so the parent can navigate to the default branch
   * while simultaneously applying the source change in one atomic step.
   */
  onRefRevertToDefault?: (newSource: string) => void;
  /** Outer container styling preset. Defaults to "popover-header". */
  presentation?: SourceSelectorPresentation;
}

/**
 * The source selector panel — choose which git server (or "nostr") to use
 * as the authoritative source when git and Nostr are out of sync.
 *
 * Shows:
 *   - Default row (always first, resolves to nostr or the ahead-git server)
 *   - Explicit nostr row (only when default isn't already nostr)
 *   - Grasp server rows (if any)
 *   - Other git server rows
 *
 * Clicking a selectable row sets it as the verification source.
 */
export function SourceSelector({
  selectedSource,
  onSelectSource,
  repoState,
  repoRelayEose,
  stateCreatedAt,
  urlStates,
  cloneUrls,
  graspCloneUrls,
  additionalGitServerUrls,
  stateBehindGit,
  poolWarning,
  pool,
  relayStateMap,
  currentRefFullName,
  currentRefIsDefault,
  onRefRevertToDefault,
  presentation = "popover-header",
}: SourceSelectorProps) {
  const hasState =
    repoRelayEose && repoState !== null && repoState !== undefined;
  const gitIsAhead = poolWarning?.kind === "state-behind-git";
  const gitCommitterDate =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitCommitterDate
      : undefined;

  const usesGrasp = graspCloneUrls.length > 0;
  const graspUrls = cloneUrls.filter((u) => graspCloneUrls.includes(u));
  const otherUrls = cloneUrls.filter((u) =>
    additionalGitServerUrls.includes(u),
  );

  // Whether the nostr state includes the current ref
  const nostrHasCurrentRef = useMemo(() => {
    if (!currentRefFullName || currentRefIsDefault) return true; // default always present
    if (!repoState || !repoRelayEose) return undefined; // unknown
    return repoState.refs.some((r) => r.name === currentRefFullName);
  }, [currentRefFullName, currentRefIsDefault, repoState, repoRelayEose]);

  const nostrSubLine = useMemo(() => {
    if (repoState === undefined || !repoRelayEose) return "Checking relays…";
    if (repoState === null) return "No Nostr state published";
    // If the current ref isn't in the nostr state, say so clearly
    if (nostrHasCurrentRef === false) {
      return "doesn't have this ref — will show default branch";
    }
    if (stateCreatedAt) {
      return `State published ${safeFormatDistanceToNow(stateCreatedAt, { addSuffix: true })}`;
    }
    return "Nostr state available";
  }, [repoState, repoRelayEose, stateCreatedAt, nostrHasCurrentRef]);

  /**
   * Return the most recent older state event across all relays, if any exists.
   * The same result is used for every server row since we're searching all
   * known relay state versions rather than restricting to a per-server relay.
   */
  const olderStateEvent: NostrEvent | undefined =
    relayStateMap && repoState
      ? findOlderStateEvent(relayStateMap, repoState)
      : undefined;

  /**
   * Check whether a given git server URL has the current ref.
   * Returns undefined when infoRefs haven't loaded yet.
   */
  const serverHasCurrentRef = useCallback(
    (url: string): boolean | undefined => {
      if (!currentRefFullName || currentRefIsDefault) return true; // default branch always present
      const infoRefs = urlStates[url]?.infoRefs;
      if (!infoRefs) return undefined; // still loading
      return (
        infoRefs.refs[currentRefFullName] !== undefined ||
        infoRefs.refs[`${currentRefFullName}^{}`] !== undefined
      );
    },
    [currentRefFullName, currentRefIsDefault, urlStates],
  );

  /**
   * Wrap source selection: if the chosen source doesn't have the current ref,
   * also trigger a revert to the default branch — atomically via the combined
   * callback so the navigation happens in one step.
   */
  const handleSelectSource = useCallback(
    (src: string) => {
      // Check if the new source lacks the current ref
      let needsRefRevert = false;
      if (src !== "default" && src !== "nostr") {
        const hasRef = serverHasCurrentRef(src);
        if (hasRef === false) needsRefRevert = true;
      } else if (
        (src === "nostr" || src === "default") &&
        currentRefFullName &&
        !currentRefIsDefault
      ) {
        // "nostr" or "default" (when it resolves to nostr): check if nostr state has the ref
        const resolvedToNostr =
          src === "nostr" || (!stateBehindGit && repoState !== null);
        if (resolvedToNostr && nostrHasCurrentRef === false) {
          needsRefRevert = true;
        }
      }

      if (needsRefRevert) {
        onRefRevertToDefault?.(src);
      } else {
        onSelectSource(src);
      }
    },
    [
      onSelectSource,
      serverHasCurrentRef,
      onRefRevertToDefault,
      currentRefFullName,
      currentRefIsDefault,
      nostrHasCurrentRef,
      stateBehindGit,
      repoState,
    ],
  );

  // When the default source is not nostr (git server is ahead or no state),
  // show "default" as the first option and "nostr" as an explicit override.
  // When default IS nostr, only show the nostr row (labelled "nostr").
  const defaultIsNostr = !stateBehindGit && repoState !== null;

  // Domain of the git server that is ahead (used in the default row label)
  const gitAheadDomain =
    poolWarning?.kind === "state-behind-git" && poolWarning.gitServerUrl
      ? gitServerDomain(poolWarning.gitServerUrl)
      : null;

  // How far ahead the git server's default branch is relative to the nostr state
  const gitAheadDistance = useMemo(() => {
    if (
      poolWarning?.kind !== "state-behind-git" ||
      !poolWarning.gitCommitterDate ||
      !stateCreatedAt
    )
      return null;
    try {
      return formatDistanceStrict(
        new Date(poolWarning.gitCommitterDate * 1000),
        new Date(stateCreatedAt * 1000),
      );
    } catch {
      return null;
    }
  }, [poolWarning, stateCreatedAt]);

  const outerClass =
    presentation === "page-toolbar"
      ? "w-full max-w-2xl rounded-lg border bg-card shadow-sm overflow-hidden"
      : "w-full";

  return (
    <div className={outerClass}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border/40">
        <p className="text-xs font-semibold text-foreground">Explorer source</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Choose which server to explore when git and Nostr are out of sync
        </p>
      </div>

      <ScrollArea
        style={{
          maxHeight:
            "calc(var(--radix-popover-content-available-height) - 60px)",
        }}
      >
        <div className="py-1">
          {/* Default row — always first */}
          <button
            onClick={() => onSelectSource("default")}
            className={cn(
              "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors cursor-pointer",
              selectedSource === "default"
                ? stateBehindGit
                  ? "bg-amber-500/5 border-l-2 border-amber-500 pl-[14px] hover:bg-amber-500/10"
                  : "bg-purple-500/5 border-l-2 border-purple-500 pl-[14px] hover:bg-purple-500/10"
                : "hover:bg-accent/30",
            )}
          >
            <Radio
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
                repoState === undefined || !repoRelayEose
                  ? "text-muted-foreground/40"
                  : stateBehindGit
                    ? "text-amber-500"
                    : repoState === null
                      ? "text-muted-foreground/40"
                      : "text-purple-500 dark:text-purple-400",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground/90 text-[11px]">
                {stateBehindGit
                  ? gitAheadDomain
                    ? `default (${gitAheadDomain})`
                    : "default"
                  : "nostr"}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                {stateBehindGit
                  ? gitAheadDistance
                    ? `because default branch is ${gitAheadDistance} ahead of nostr`
                    : "default branch is ahead of nostr state"
                  : repoState === null
                    ? "Git server (no nostr state)"
                    : `${nostrSubLine}`}
              </p>
            </div>
            <span
              className={cn(
                "text-[10px] shrink-0",
                repoState === null || !repoRelayEose
                  ? "text-muted-foreground/40"
                  : stateBehindGit
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-purple-600 dark:text-purple-400",
              )}
            >
              {repoState === undefined || !repoRelayEose
                ? "loading"
                : repoState === null
                  ? "no state"
                  : stateBehindGit
                    ? "git ahead"
                    : "authority"}
            </span>
          </button>

          {/* Explicit nostr row — only shown when default is NOT nostr */}
          {!defaultIsNostr && (
            <button
              onClick={() => onSelectSource("nostr")}
              className={cn(
                "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors cursor-pointer",
                selectedSource === "nostr"
                  ? "bg-purple-500/5 border-l-2 border-purple-500 pl-[14px] hover:bg-purple-500/10"
                  : "hover:bg-accent/30",
              )}
            >
              <Radio
                className={cn(
                  "h-3.5 w-3.5 shrink-0 mt-0.5",
                  repoState === undefined || !repoRelayEose
                    ? "text-muted-foreground/40"
                    : repoState === null
                      ? "text-muted-foreground/40"
                      : "text-purple-500 dark:text-purple-400",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground/90 text-[11px]">
                  nostr
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {nostrSubLine}
                </p>
              </div>
              <span
                className={cn(
                  "text-[10px] shrink-0",
                  repoState === null || !repoRelayEose
                    ? "text-muted-foreground/40"
                    : "text-purple-600 dark:text-purple-400",
                )}
              >
                {repoState === undefined || !repoRelayEose
                  ? "loading"
                  : repoState === null
                    ? "no state"
                    : "Nostr state"}
              </span>
            </button>
          )}
        </div>

        {/* Grasp servers */}
        {usesGrasp && graspUrls.length > 0 && (
          <>
            <Separator />
            <div className="py-1">
              <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <GraspLogo className="h-3 w-3 text-pink-500" />
                Grasp Servers
              </div>
              {graspUrls.map((url) => (
                <SourceServerRow
                  key={url}
                  url={url}
                  urlState={urlStates[url]}
                  isGrasp={true}
                  isSelected={selectedSource === url}
                  hasState={hasState}
                  gitIsAhead={gitIsAhead}
                  stateCreatedAt={stateCreatedAt}
                  gitCommitterDate={gitCommitterDate}
                  pool={pool}
                  onSelect={() => handleSelectSource(url)}
                  olderStateEvent={olderStateEvent}
                  currentRefFullName={currentRefFullName}
                  currentRefIsDefault={currentRefIsDefault}
                  currentRefInNostrState={nostrHasCurrentRef}
                />
              ))}
            </div>
          </>
        )}

        {/* Separator between sections */}
        {usesGrasp && otherUrls.length > 0 && <Separator />}

        {/* Other git servers */}
        {otherUrls.length > 0 && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Server className="h-3 w-3" />
              {usesGrasp ? "Other Git Servers" : "Git Servers"}
            </div>
            {otherUrls.map((url) => (
              <SourceServerRow
                key={url}
                url={url}
                urlState={urlStates[url]}
                isGrasp={false}
                isSelected={selectedSource === url}
                hasState={hasState}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
                onSelect={() => handleSelectSource(url)}
                olderStateEvent={olderStateEvent}
                currentRefFullName={currentRefFullName}
                currentRefIsDefault={currentRefIsDefault}
                currentRefInNostrState={nostrHasCurrentRef}
              />
            ))}
          </div>
        )}

        {/* Fallback: cloneUrls not split into grasp/other */}
        {!usesGrasp && otherUrls.length === 0 && cloneUrls.length > 0 && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Server className="h-3 w-3" />
              Git Servers
            </div>
            {cloneUrls.map((url) => (
              <SourceServerRow
                key={url}
                url={url}
                urlState={urlStates[url]}
                isGrasp={false}
                isSelected={selectedSource === url}
                hasState={hasState}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
                onSelect={() => handleSelectSource(url)}
                olderStateEvent={olderStateEvent}
                currentRefFullName={currentRefFullName}
                currentRefIsDefault={currentRefIsDefault}
                currentRefInNostrState={nostrHasCurrentRef}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceSelectorDropdown — popover-trigger variant for full-page toolbars
// ---------------------------------------------------------------------------

export interface SourceSelectorDropdownProps extends SourceSelectorProps {
  /**
   * Pool's currently-winning git server URL. Required to resolve the
   * "default" sentinel into a concrete effective source for the trigger
   * label.
   */
  winnerUrl?: string | null;
  /** Popover content alignment (defaults to "end" — right-aligned). */
  contentAlign?: "start" | "end" | "center";
  className?: string;
}

/**
 * Dropdown wrapper around `SourceSelector` for full-page toolbars
 * (`/branches`, `/tags`). Renders a compact trigger button — like the source
 * row in the popover ref selector — and opens the full SourceSelector panel
 * in a popover on click.
 *
 * The trigger surfaces the currently-resolved source (and a small status
 * accent when git and Nostr are out of sync) so the user can see at a glance
 * what's authoritative without opening the panel.
 */
export function SourceSelectorDropdown({
  winnerUrl,
  contentAlign = "end",
  className,
  ...selectorProps
}: SourceSelectorDropdownProps) {
  const {
    selectedSource,
    repoState,
    repoRelayEose,
    stateBehindGit,
    poolWarning,
    onSelectSource,
    onRefRevertToDefault,
  } = selectorProps;

  const [open, setOpen] = useState(false);
  const { triggerRef, popoverStyle, avoidCollisions, isMobile } =
    useMobilePopoverFullWidth<HTMLButtonElement>({ open });

  const isLoading = repoState === undefined || !repoRelayEose;
  const isNoState = repoRelayEose && repoState === null;

  const aheadServerUrl =
    poolWarning?.kind === "state-behind-git" ? poolWarning.gitServerUrl : null;
  const effectiveSource = deriveEffectiveSource(
    selectedSource,
    stateBehindGit,
    isNoState,
    winnerUrl,
    aheadServerUrl,
  );
  const effectiveSourceIsGitServer = effectiveSource !== "nostr";
  const isManualGitSource =
    selectedSource !== "default" && selectedSource !== "nostr";
  const sourceIsNostr = !effectiveSourceIsGitServer;
  const hasProblems = stateBehindGit;

  const sourceLabel = effectiveSourceIsGitServer
    ? selectedSource === "default"
      ? `default (${gitServerDomain(effectiveSource)})`
      : shortServerLabel(effectiveSource)
    : "nostr";

  // Close popover after selection so the trigger re-focuses naturally.
  const handleSelectSource = useCallback(
    (src: string) => {
      onSelectSource(src);
      setOpen(false);
    },
    [onSelectSource],
  );

  const handleRefRevertToDefault = useCallback(
    (newSource: string) => {
      onRefRevertToDefault?.(newSource);
      setOpen(false);
    },
    [onRefRevertToDefault],
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors",
            "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            hasProblems &&
              !isManualGitSource &&
              "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
            className,
          )}
        >
          {sourceIsNostr ? (
            <Radio
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isLoading
                  ? "text-muted-foreground/40"
                  : "text-purple-500 dark:text-purple-400",
              )}
            />
          ) : (
            <Server
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                hasProblems && !isManualGitSource
                  ? "text-amber-500"
                  : isManualGitSource
                    ? "text-blue-500 dark:text-blue-400"
                    : "text-muted-foreground/60",
              )}
            />
          )}

          <span className="text-muted-foreground/60 shrink-0 hidden sm:inline">
            Source
          </span>

          <span
            className={cn(
              "font-medium truncate max-w-[160px] sm:max-w-[220px]",
              isLoading
                ? "text-muted-foreground/50"
                : isManualGitSource
                  ? "text-blue-600 dark:text-blue-400"
                  : sourceIsNostr
                    ? "text-purple-600 dark:text-purple-400"
                    : hasProblems
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground/80",
            )}
          >
            {sourceLabel}
          </span>

          {hasProblems && !isManualGitSource && (
            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
          )}

          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className={cn(
          "p-0 overflow-hidden z-50",
          isMobile ? "w-screen" : "w-[480px]",
        )}
        align={contentAlign}
        side="bottom"
        sideOffset={6}
        style={popoverStyle}
        avoidCollisions={avoidCollisions}
      >
        <SourceSelector
          {...selectorProps}
          presentation="popover-header"
          onSelectSource={handleSelectSource}
          onRefRevertToDefault={
            onRefRevertToDefault ? handleRefRevertToDefault : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
