import { useMemo } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useResolvedRepository } from "@/hooks/useResolvedRepository";
import RepoIssuesPage from "./RepoIssuesPage";
import RepoPRsPage from "./RepoPRsPage";
import RepoCodePage from "./RepoCodePage";
import RepoAboutPage from "./RepoAboutPage";
import RepoCommitsPage from "./RepoCommitsPage";
import RepoCommitPage from "./RepoCommitPage";
import IssuePage from "@/pages/IssuePage";
import PRPage from "@/pages/PRPage";
import PRCommitPage from "@/pages/PRCommitPage";
import { useIssues } from "@/hooks/useIssues";
import { usePRs } from "@/hooks/usePRs";
import { useDnsIdentity } from "@/hooks/useDnsIdentity";
import { useRepositoryState } from "@/hooks/useRepositoryState";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { useProfile } from "@/hooks/useProfile";
import { UserAvatar } from "@/components/UserAvatar";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { nip19 } from "nostr-tools";
import {
  ArrowLeft,
  CircleDot,
  GitPullRequest,
  AlertCircle,
  Loader2,
  Code2,
  GitCommit,
  Info,
} from "lucide-react";
import { RepoContext, type RepoContextValue } from "./RepoContext";
import { PATCH_KIND, PR_KIND, type RepoQueryOptions } from "@/lib/nip34";
import type { Filter as NostrFilter } from "applesauce-core/helpers";
import { relayCurationMode } from "@/services/settings";
import { cn } from "@/lib/utils";
import {
  parseRepoRoute,
  decodeEventIdentifier,
  isEventIdentifier,
} from "@/lib/routeUtils";

// ---------------------------------------------------------------------------
// RepoLayout
// ---------------------------------------------------------------------------

export default function RepoLayout() {
  // The splat param (*) captures everything after the leading /
  const { "*": splat } = useParams<{ "*": string }>();
  const location = useLocation();

  const parsed = useMemo(
    () => (splat ? parseRepoRoute(splat) : undefined),
    [splat],
  );

  // If the path doesn't parse as a repo route at all, show not-found immediately
  if (!parsed) {
    return <RouteNotFound splat={splat ?? ""} />;
  }

  if (parsed.type === "npub") {
    return (
      <RepoLayoutResolved
        pubkey={parsed.pubkey}
        repoId={parsed.repoId}
        relayHints={parsed.relayHints}
        location={location}
        splat={splat ?? ""}
      />
    );
  }

  // nip05 — needs async resolution
  return (
    <RepoLayoutNip05
      nip05={parsed.nip05}
      repoId={parsed.repoId}
      relayHints={parsed.relayHints}
      location={location}
      splat={splat ?? ""}
    />
  );
}

// ---------------------------------------------------------------------------
// NIP-05 resolver wrapper
// ---------------------------------------------------------------------------

function RepoLayoutNip05({
  nip05,
  repoId,
  relayHints,
  location,
  splat,
}: {
  nip05: string;
  repoId: string;
  relayHints: string[];
  location: ReturnType<typeof useLocation>;
  splat: string;
}) {
  const identity = useDnsIdentity(nip05);

  if (identity.status === "loading") {
    return <Nip05LoadingState nip05={nip05} />;
  }

  if (identity.status === "not-found") {
    return <Nip05NotFoundError nip05={nip05} />;
  }

  if (identity.status === "error") {
    return <Nip05ResolveError nip05={nip05} reason={identity.reason} />;
  }

  // Merge relay hints: identity relays first (authoritative), then URL hints
  const mergedRelays = [
    ...identity.relays,
    ...relayHints.filter((r) => !identity.relays.includes(r)),
  ];

  return (
    <RepoLayoutResolved
      pubkey={identity.pubkey}
      repoId={repoId}
      relayHints={mergedRelays}
      location={location}
      splat={splat}
      nip05={nip05}
    />
  );
}

// ---------------------------------------------------------------------------
// Core layout (pubkey already known)
// ---------------------------------------------------------------------------

function RepoLayoutResolved({
  pubkey,
  repoId,
  relayHints,
  location,
  splat,
  nip05,
}: {
  pubkey: string;
  repoId: string;
  relayHints: string[];
  location: ReturnType<typeof useLocation>;
  splat: string;
  nip05?: string;
}) {
  const store = useEventStore();
  const resolved = useResolvedRepository(pubkey, repoId, relayHints);
  const repo = resolved?.repo;
  const repoRelayGroup = resolved?.repoRelayGroup;
  const extraRelaysForMaintainerMailboxCoverage =
    resolved?.extraRelaysForMaintainerMailboxCoverage;

  // Respect the user's relay curation preference.
  const curationMode = use$(relayCurationMode);

  // In outbox mode, also subscribe to the extra maintainer mailbox relays so
  // issues and PRs published only to those relays are discovered.
  const coordKey = repo?.allCoordinates?.join(",") ?? "";
  use$(() => {
    if (
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage ||
      !repo?.allCoordinates?.length
    )
      return undefined;
    const filters = [
      {
        kinds: [1621, PATCH_KIND, PR_KIND],
        "#a": repo.allCoordinates,
      } as NostrFilter,
    ];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(filters)
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [curationMode, extraRelaysForMaintainerMailboxCoverage, coordKey, store]);

  const queryOptions: RepoQueryOptions = useMemo(
    () => ({
      relayHints,
      useItemAuthorRelays: false,
      maintainerPubkeys: repo?.maintainerSet ?? [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relayHints.join(","), repo?.maintainerSet?.join(","), curationMode],
  );

  const issues = useIssues(repo?.allCoordinates, repoRelayGroup, queryOptions);
  const prs = usePRs(repo?.allCoordinates, repoRelayGroup, queryOptions);

  const [repoState, repoRelayEose] = useRepositoryState(
    repo?.dTag,
    repo?.maintainerSet,
    repoRelayGroup,
  );

  // Count open issues for the tab badge
  const openIssueCount = useMemo(() => {
    if (!issues) return undefined;
    return issues.filter((i) => i.status === "open").length;
  }, [issues]);

  // Count open PRs for the tab badge
  const openPRCount = useMemo(() => {
    if (!prs) return undefined;
    return prs.filter((p) => p.status === "open").length;
  }, [prs]);

  // Build the base path from the splat so tab links stay consistent with
  // whatever URL format the user arrived with (npub, nip05, relay hint, etc.)
  // Strip any trailing sub-paths (issues, prs, about, tree, commit, commits)
  // to get the repo root.
  const basePath = useMemo(() => {
    const full = `/${splat}`;
    // Remove known sub-paths — find the first occurrence of any keyword
    for (const keyword of [
      "/issues",
      "/prs",
      "/about",
      "/tree",
      "/commit",
      "/commits",
    ]) {
      const idx = full.indexOf(keyword);
      if (idx !== -1) return full.slice(0, idx);
    }
    return full;
  }, [splat]);

  const isCodeTab =
    location.pathname.startsWith(`${basePath}/tree`) ||
    location.pathname === basePath ||
    location.pathname === `${basePath}/`;
  const isCommitsTab =
    location.pathname.startsWith(`${basePath}/commits`) ||
    location.pathname.startsWith(`${basePath}/commit`);
  const isIssuesTab = location.pathname.startsWith(`${basePath}/issues`);
  const isPRsTab = location.pathname.startsWith(`${basePath}/prs`);
  const isAboutTab = location.pathname.startsWith(`${basePath}/about`);
  // Determine which sub-page to render from the splat segments.
  const {
    subPage,
    issueId,
    prId,
    treeRefAndPath,
    commitId,
    commitsRef,
    prCommitId,
  } = useMemo((): {
    subPage:
      | "code"
      | "issues"
      | "issue"
      | "prs"
      | "pr"
      | "pr-commit"
      | "commits"
      | "commit"
      | "about";
    issueId?: string;
    prId?: string;
    /** Everything after /tree/ — ref resolution happens inside useGitExplorer */
    treeRefAndPath?: string;
    commitId?: string;
    commitsRef?: string;
    prCommitId?: string;
  } => {
    const segments = splat.split("/").filter(Boolean);

    // Find the index of the first known sub-path keyword
    const treeIdx = segments.indexOf("tree");
    if (treeIdx !== -1) {
      // Pass everything after "tree" as a single string; useGitExplorer will
      // resolve the ref via longest-prefix matching against known git refs.
      const refAndPath = segments.slice(treeIdx + 1).join("/");
      return { subPage: "code", treeRefAndPath: refAndPath || undefined };
    }

    const prsIdx = segments.indexOf("prs");
    if (prsIdx !== -1) {
      if (segments.length > prsIdx + 1) {
        const rawSegment = segments[prsIdx + 1];
        // Accept both raw hex IDs (legacy) and nevent1/note1 identifiers
        const prId = isEventIdentifier(rawSegment)
          ? decodeEventIdentifier(rawSegment)
          : rawSegment;

        // prs/<id>/commit/<hash> — commit detail scoped to a PR
        const prCommitIdx = segments.indexOf("commit", prsIdx + 2);
        if (prCommitIdx !== -1) {
          return {
            subPage: "pr-commit",
            prId,
            prCommitId: segments[prCommitIdx + 1],
          };
        }

        // prs/<id>/commits — commits list scoped to a PR (renders PRPage
        // with the commits tab pre-selected via context)
        const prCommitsIdx = segments.indexOf("commits", prsIdx + 2);
        if (prCommitsIdx !== -1) {
          return { subPage: "pr", prId };
        }

        return { subPage: "pr", prId };
      }
      return { subPage: "prs" };
    }

    const commitIdx = segments.indexOf("commit");
    if (commitIdx !== -1) {
      return { subPage: "commit", commitId: segments[commitIdx + 1] };
    }

    const commitsIdx = segments.indexOf("commits");
    if (commitsIdx !== -1) {
      return {
        subPage: "commits",
        commitsRef: segments.slice(commitsIdx + 1).join("/") || undefined,
      };
    }

    const issuesIdx = segments.indexOf("issues");
    if (issuesIdx !== -1) {
      if (segments.length > issuesIdx + 1) {
        const rawSegment = segments[issuesIdx + 1];
        // Accept both raw hex IDs (legacy) and nevent1/note1 identifiers
        const issueId = isEventIdentifier(rawSegment)
          ? decodeEventIdentifier(rawSegment)
          : rawSegment;
        return { subPage: "issue", issueId };
      }
      return { subPage: "issues" };
    }

    const aboutIdx = segments.indexOf("about");
    if (aboutIdx !== -1) {
      return { subPage: "about" };
    }

    return { subPage: "code" };
  }, [splat]);

  const cloneUrls = repo?.cloneUrls ?? [];

  // The PR base path: basePath + /prs/<prId> — used for PR sub-route links.
  const prBasePath = useMemo(() => {
    if (!prId) return undefined;
    const full = `/${splat}`;
    const prsIdx = full.indexOf("/prs/");
    if (prsIdx === -1) return undefined;
    // Find the end of the prId segment (next "/" after prs/<id>)
    const afterPrs = prsIdx + "/prs/".length;
    const nextSlash = full.indexOf("/", afterPrs);
    return nextSlash === -1 ? full : full.slice(0, nextSlash);
  }, [splat, prId]);

  const ctxValue: RepoContextValue | null =
    pubkey && repoId
      ? {
          pubkey,
          repoId,
          resolved,
          issues,
          prs,
          queryOptions,
          nip05,
          issueId,
          prId,
          cloneUrls,
          repoState,
          repoRelayEose,
          treeRefAndPath,
          commitId,
          commitsRef,
          prCommitId,
          prBasePath,
        }
      : null;

  return (
    <div className="min-h-full">
      {/* Repo header */}
      <div className="relative isolate border-b border-border/40">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />

        <div className="container max-w-screen-xl px-4 md:px-8 pt-6 pb-0">
          {repo ? (
            <RepoBreadcrumb
              pubkey={pubkey}
              repoName={repo.name}
              basePath={basePath}
              nip05={nip05}
            />
          ) : (
            <div className="flex items-center gap-1.5 mb-4">
              <Skeleton className="h-5 w-24" />
              <span className="text-muted-foreground">/</span>
              <Skeleton className="h-5 w-32" />
            </div>
          )}

          {/* Tab navigation */}
          <nav className="flex gap-1 -mb-px">
            <TabLink
              to={basePath}
              active={isCodeTab}
              icon={<Code2 className="h-4 w-4" />}
              label="Code"
            />
            <TabLink
              to={
                commitsRef
                  ? `${basePath}/commits/${commitsRef}`
                  : `${basePath}/commits`
              }
              active={isCommitsTab}
              icon={<GitCommit className="h-4 w-4" />}
              label="Commits"
            />
            <TabLink
              to={`${basePath}/issues`}
              active={isIssuesTab}
              icon={<CircleDot className="h-4 w-4" />}
              label="Issues"
              count={openIssueCount}
            />
            <TabLink
              to={`${basePath}/prs`}
              active={isPRsTab}
              icon={<GitPullRequest className="h-4 w-4" />}
              label="PRs"
              count={openPRCount}
            />
            <TabLink
              to={`${basePath}/about`}
              active={isAboutTab}
              icon={<Info className="h-4 w-4" />}
              label="About"
            />
          </nav>
        </div>
      </div>

      {/* Page content */}
      {ctxValue ? (
        <RepoContext.Provider value={ctxValue}>
          {subPage === "code" ? (
            <RepoCodePage />
          ) : subPage === "commits" ? (
            <RepoCommitsPage />
          ) : subPage === "commit" ? (
            <RepoCommitPage />
          ) : subPage === "issue" ? (
            <IssuePage />
          ) : subPage === "issues" ? (
            <RepoIssuesPage />
          ) : subPage === "pr" ? (
            <PRPage />
          ) : subPage === "pr-commit" ? (
            <PRCommitPage />
          ) : subPage === "prs" ? (
            <RepoPRsPage />
          ) : subPage === "about" ? (
            <RepoAboutPage />
          ) : null}
        </RepoContext.Provider>
      ) : (
        <div className="container max-w-screen-xl px-4 md:px-8 py-6">
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error / loading states
// ---------------------------------------------------------------------------

function Nip05LoadingState({ nip05 }: { nip05: string }) {
  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-violet-500/10">
            <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
          </div>
        </div>
        <h2 className="text-xl font-semibold">Resolving identity</h2>
        <p className="text-muted-foreground text-sm">
          Looking up <span className="font-mono text-foreground">{nip05}</span>…
        </p>
      </div>
    </div>
  );
}

function Nip05NotFoundError({ nip05 }: { nip05: string }) {
  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Identity not found</h2>
          <p className="text-muted-foreground">
            The NIP-05 address{" "}
            <span className="font-mono text-foreground">{nip05}</span> could not
            be found. Make sure the address is correct and the domain's{" "}
            <span className="font-mono text-sm">/.well-known/nostr.json</span>{" "}
            is reachable.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to repositories
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Nip05ResolveError({
  nip05,
  reason,
}: {
  nip05: string;
  reason: "timeout" | "network" | "unknown";
}) {
  const detail =
    reason === "timeout"
      ? "The lookup timed out. The domain may be slow or unreachable."
      : reason === "network"
        ? "A network error occurred. Check your connection and that the domain's /.well-known/nostr.json is accessible."
        : "An unexpected error occurred while looking up the NIP-05 address.";

  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Failed to resolve identity</h2>
          <p className="text-muted-foreground">
            Could not look up{" "}
            <span className="font-mono text-foreground">{nip05}</span>.
          </p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to repositories
          </Link>
        </Button>
      </div>
    </div>
  );
}

function RouteNotFound({ splat }: { splat: string }) {
  return (
    <div className="min-h-full flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-muted">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Page not found</h2>
          <p className="text-muted-foreground">
            <span className="font-mono text-foreground">/{splat}</span> doesn't
            match a known repository URL format.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to repositories
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repo breadcrumb: <username> / <repo-name>
// ---------------------------------------------------------------------------

function RepoBreadcrumb({
  pubkey,
  repoName,
  basePath,
  nip05,
}: {
  pubkey: string;
  repoName: string;
  basePath: string;
  nip05?: string;
}) {
  const profile = useProfile(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const nip05Local = nip05?.split("@")[0];
  const nip05Domain = nip05?.split("@")[1];
  const nip05Label = nip05Local === "_" ? nip05Domain : nip05Local;
  const username =
    profile?.displayName ??
    profile?.name ??
    nip05Label ??
    npub.slice(0, 12) + "…";

  return (
    <div className="flex items-center gap-2 mb-4">
      <Link
        to={`/${npub}`}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <UserAvatar pubkey={pubkey} size="sm" />
        <span className="text-base font-medium">{username}</span>
      </Link>
      <span className="text-muted-foreground font-normal">/</span>
      <Link
        to={basePath}
        className="text-base font-semibold text-foreground hover:text-violet-500 transition-colors"
      >
        {repoName}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab link
// ---------------------------------------------------------------------------

function TabLink({
  to,
  active,
  icon,
  label,
  count,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-violet-500 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <Badge
          variant="secondary"
          className="ml-1 h-5 min-w-[20px] px-1.5 text-[11px] font-medium"
        >
          {count}
        </Badge>
      )}
    </Link>
  );
}
