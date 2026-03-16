import { useMemo } from "react";
import { Link, Outlet, useParams, useLocation } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useResolvedRepository } from "@/hooks/useResolvedRepository";
import { useIssues } from "@/hooks/useIssues";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { mapEventsToStore } from "applesauce-core";
import { onlyEvents } from "applesauce-relay";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  ExternalLink,
  ArrowLeft,
  Info,
  CircleDot,
} from "lucide-react";
import { RepoContext, type RepoContextValue } from "./RepoContext";
import type { RepoQueryOptions } from "@/lib/nip34";
import type { Filter as NostrFilter } from "applesauce-core/helpers";
import { relayCurationMode } from "@/services/settings";
import { cn } from "@/lib/utils";

export default function RepoLayout({
  relayHints = [],
}: {
  relayHints?: string[];
}) {
  const { npub, repoId } = useParams<{ npub: string; repoId: string }>();
  const location = useLocation();

  // Decode npub to hex pubkey
  const pubkey = useMemo(() => {
    if (!npub) return undefined;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === "npub") return decoded.data;
      return undefined;
    } catch {
      return undefined;
    }
  }, [npub]);

  const store = useEventStore();
  const resolved = useResolvedRepository(pubkey, repoId);
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

  // Determine active tab from URL
  const basePath = `/${npub}/${repoId}`;
  const isIssuesTab = location.pathname.startsWith(`${basePath}/issues`);
  const isAboutTab = !isIssuesTab;

  const ctxValue: RepoContextValue | null =
    npub && repoId && pubkey
      ? { npub, repoId, pubkey, resolved, issues, queryOptions }
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
