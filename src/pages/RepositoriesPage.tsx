import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useAllRepositories } from "@/hooks/useAllRepositories";
import { repoToPath } from "@/lib/routeUtils";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  Search,
  ExternalLink,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { ResolvedRepo } from "@/lib/nip34";
import { formatDistanceToNow } from "date-fns";

const PAGE_SIZE = 50;

interface RepositoriesPageProps {
  /** When set, query this relay instead of the user's configured git index relays. */
  relayOverride?: string[];
  /** Display label for the relay (e.g. "relay.ngit.dev") shown in the hero. */
  relayLabel?: string;
}

export default function RepositoriesPage({
  relayOverride,
  relayLabel,
}: RepositoriesPageProps) {
  const { repos, isSyncing } = useAllRepositories(relayOverride);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const title = relayLabel
    ? `Repositories on ${relayLabel} - ngit`
    : "Repositories - ngit";

  useSeoMeta({
    title,
    description: relayLabel
      ? `Browse git repositories on ${relayLabel}`
      : "Browse git repositories on Nostr",
  });

  // Reset visible count when search changes so results start from the top
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const filtered = useMemo(() => {
    if (!repos) return undefined;
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [repos, search]);

  const visible = useMemo(
    () => filtered?.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const loadMore = useCallback(() => {
    setVisibleCount((c) => c + PAGE_SIZE);
  }, []);

  // IntersectionObserver sentinel for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const hasMore = filtered !== undefined && visibleCount < filtered.length;

  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <div className="relative isolate overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />
        <div className="absolute top-0 left-1/4 w-96 h-96 -z-10 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 -z-10 bg-fuchsia-500/10 rounded-full blur-3xl" />

        <div className="container max-w-screen-xl px-4 md:px-8 py-12 md:py-16">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="h-5 w-5 text-violet-500" />
            <span className="text-sm font-medium text-muted-foreground">
              {relayLabel ? relayLabel : "Powered by Nostr"}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-600 dark:from-violet-400 dark:via-fuchsia-400 dark:to-violet-400 bg-clip-text text-transparent">
              Git Repositories
            </span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mb-8">
            {relayLabel
              ? `Repositories indexed on ${relayLabel}.`
              : "Decentralized code collaboration. Browse repositories, track issues, and contribute -- all over Nostr."}
          </p>

          <div className="flex items-center gap-4">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search repositories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-background/60 backdrop-blur-sm border-border/60 focus-visible:ring-violet-500/30"
              />
            </div>

            {/* Sync status indicator */}
            {isSyncing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span>Syncing…</span>
                {repos && (
                  <span className="text-muted-foreground/60">
                    {repos.length} found
                  </span>
                )}
              </div>
            )}
            {!isSyncing && repos && (
              <span className="text-sm text-muted-foreground/60">
                {repos.length} repositories
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Repository list */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        {!visible ? (
          <div className="grid gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <RepoSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground text-lg">
                {search
                  ? "No repositories match your search"
                  : "No repositories found on this relay"}
              </p>
              <p className="text-muted-foreground/60 text-sm mt-1">
                {isSyncing
                  ? "Still syncing — check back in a moment"
                  : "Try a different search or check back later"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3">
              {visible.map((repo) => (
                <RepoCard
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
              </div>
            )}

            {!hasMore && filtered && filtered.length > PAGE_SIZE && (
              <p className="text-center text-sm text-muted-foreground/40 py-8">
                All {filtered.length} repositories loaded
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: ResolvedRepo }) {
  const repoPath = repoToPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  return (
    <Link to={repoPath} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
                  <GitBranch className="h-4 w-4 text-violet-500" />
                </div>
                <h3 className="font-semibold text-base truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                  {repo.name}
                </h3>
              </div>

              {repo.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3 ml-9">
                  {repo.description}
                </p>
              )}

              <div className="flex items-center gap-3 ml-9 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {repo.maintainerSet.map((pk) => (
                    <UserLink
                      key={pk}
                      pubkey={pk}
                      avatarSize="sm"
                      nameClassName="text-xs text-muted-foreground"
                      noLink
                    />
                  ))}
                </div>

                <span className="text-xs text-muted-foreground/60">
                  {timeAgo}
                </span>

                {repo.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {repo.labels.slice(0, 3).map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-5"
                      >
                        {label}
                      </Badge>
                    ))}
                    {repo.labels.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{repo.labels.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {repo.webUrls.length > 0 && (
              <ExternalLink className="h-4 w-4 text-muted-foreground/40 group-hover:text-violet-500 transition-colors shrink-0 mt-1" />
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function RepoSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="ml-9 space-y-2">
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
