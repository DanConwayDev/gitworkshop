import { useMemo } from "react";
import { Link, Outlet, useParams, useLocation } from "react-router-dom";
import { useResolvedRepository } from "@/hooks/useResolvedRepository";
import { useIssues } from "@/hooks/useIssues";
import { useDnsIdentity } from "@/hooks/useDnsIdentity";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  ExternalLink,
  ArrowLeft,
  Info,
  CircleDot,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { RepoContext, type RepoContextValue } from "./RepoContext";
import type { RepoQueryOptions } from "@/lib/nip34";
import type { Filter as NostrFilter } from "applesauce-core/helpers";
import { relayCurationMode } from "@/services/settings";
import { cn } from "@/lib/utils";
import { parseRepoRoute } from "@/lib/routeUtils";

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
  // issues published only to those relays are discovered.
  const coordKey = repo?.allCoordinates?.join(",") ?? "";
  use$(() => {
    if (
      curationMode !== "outbox" ||
      !extraRelaysForMaintainerMailboxCoverage ||
      !repo?.allCoordinates?.length
    )
      return undefined;
    const issueFilters = [
      { kinds: [1621], "#a": repo.allCoordinates } as NostrFilter,
    ];
    return extraRelaysForMaintainerMailboxCoverage
      .subscription(issueFilters)
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

  // Count open issues for the tab badge
  const openIssueCount = useMemo(() => {
    if (!issues) return undefined;
    return issues.filter((i) => i.status === "open").length;
  }, [issues]);

  // Build the base path from the splat so tab links stay consistent with
  // whatever URL format the user arrived with (npub, nip05, relay hint, etc.)
  // Strip any trailing sub-paths (issues, issues/:id) to get the repo root.
  const basePath = useMemo(() => {
    const full = `/${splat}`;
    // Remove known sub-paths
    for (const suffix of ["/issues", "/about"]) {
      const idx = full.indexOf(suffix);
      if (idx !== -1) return full.slice(0, idx);
    }
    return full;
  }, [splat]);

  const isIssuesTab = location.pathname.startsWith(`${basePath}/issues`);
  const isAboutTab = !isIssuesTab;

  const ctxValue: RepoContextValue | null =
    pubkey && repoId
      ? { pubkey, repoId, resolved, issues, queryOptions, nip05 }
      : null;

  return (
    <div className="min-h-screen">
      {/* Repo header */}
      <div className="relative isolate border-b border-border/40">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />

        <div className="container max-w-screen-xl px-4 md:px-8 pt-8 pb-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All repositories
          </Link>

          {repo ? (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
                  <GitBranch className="h-5 w-5 text-violet-500" />
                </div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {repo.name}
                </h1>
                {repo.webUrls.length > 0 && (
                  <a
                    href={repo.webUrls[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-violet-500 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              {repo.description && (
                <p className="text-muted-foreground ml-12 mb-3 max-w-2xl">
                  {repo.description}
                </p>
              )}
              <div className="flex items-center gap-3 ml-12 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <UserLink
                    pubkey={repo.selectedMaintainer}
                    avatarSize="sm"
                    nameClassName="text-sm text-muted-foreground"
                  />
                  {repo.maintainerSet
                    .filter((pk) => pk !== repo.selectedMaintainer)
                    .map((pk) => (
                      <UserLink
                        key={pk}
                        pubkey={pk}
                        avatarSize="sm"
                        nameClassName="text-sm text-muted-foreground"
                      />
                    ))}
                </div>
                {repo.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {repo.labels.map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-xs"
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 mb-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-5 w-96" />
              <div className="flex gap-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          )}

          {/* Tab navigation */}
          <nav className="flex gap-1 -mb-px">
            <TabLink
              to={basePath}
              active={isAboutTab}
              icon={<Info className="h-4 w-4" />}
              label="About"
            />
            <TabLink
              to={`${basePath}/issues`}
              active={isIssuesTab}
              icon={<CircleDot className="h-4 w-4" />}
              label="Issues"
              count={openIssueCount}
            />
          </nav>
        </div>
      </div>

      {/* Page content via nested route */}
      {ctxValue ? (
        <RepoContext.Provider value={ctxValue}>
          <Outlet />
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
    <div className="min-h-screen flex items-center justify-center">
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
    <div className="min-h-screen flex items-center justify-center">
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
    <div className="min-h-screen flex items-center justify-center">
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
    <div className="min-h-screen flex items-center justify-center">
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
