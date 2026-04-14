import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type React from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepositorySearch } from "@/hooks/useRepositorySearch";
import { useRepoPath } from "@/hooks/useRepoPath";
import { usePrefetchNip05 } from "@/hooks/usePrefetchNip05";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Search, ExternalLink, Loader2, User } from "lucide-react";
import type { ResolvedRepo } from "@/lib/nip34";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "@/hooks/use$";
import { pool } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";

interface RepositoriesPageProps {
  /** When set, query this relay instead of the user's configured git index relays. */
  relayOverride?: string[];
  /** Display label for the relay (e.g. "relay.ngit.dev") shown in the hero. */
  relayLabel?: string;
  /** Optional banner rendered below the hero description (e.g. relay status). */
  relayStatusBanner?: React.ReactNode;
}

export default function RepositoriesPage({
  relayOverride,
  relayLabel,
  relayStatusBanner,
}: RepositoriesPageProps) {
  const [search, setSearch] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { repos, isLoading, hasMore, loadMore, matchedUserPubkeys } =
    useRepositorySearch(search, relayOverride);

  const title = relayLabel
    ? `Repositories on ${relayLabel} - ngit`
    : "Repositories - ngit";

  useSeoMeta({
    title,
    description: relayLabel
      ? `Browse git repositories on ${relayLabel}`
      : "Browse git repositories on Nostr",
  });

  // IntersectionObserver sentinel for infinite scroll (browse mode only)
  const handleIntersect = useCallback(() => {
    if (hasMore && !isLoading) loadMore();
  }, [hasMore, isLoading, loadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) handleIntersect();
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

  // Determine what to render in the list area
  const showSkeletons =
    repos === undefined || (isLoading && repos.length === 0);
  const showEmpty = !showSkeletons && repos !== undefined && repos.length === 0;
  const showList = !showSkeletons && repos !== undefined && repos.length > 0;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border/40">
        <div className="container max-w-screen-xl px-4 md:px-8 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
              {relayLabel ?? "Repository announcements"}
            </h1>
          </div>

          {/* Relay status banner (connection state, repo count, etc.) */}
          {relayStatusBanner && <div>{relayStatusBanner}</div>}

          <div className="flex items-center gap-4">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search repositories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-background/60 backdrop-blur-sm border-border/60 focus-visible:ring-pink-500/30"
                autoFocus
              />
            </div>

            {/* Loading indicator — only shown during active fetches */}
            {isLoading && repos !== undefined && repos.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-pink-500" />
                <span>Loading…</span>
              </div>
            )}
          </div>

          {/* Relay pills — show which relays are being searched */}
          <RelayPillsRow relayOverride={relayOverride} />
        </div>
      </div>

      {/* Repository list */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        {showSkeletons ? (
          <div className="grid gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <RepoSkeleton key={i} />
            ))}
          </div>
        ) : showEmpty ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground text-lg">
                {search
                  ? "No repositories match your search"
                  : "No repositories found on this relay"}
              </p>
              <p className="text-muted-foreground/60 text-sm mt-1">
                Try a different search or check back later
              </p>
            </CardContent>
          </Card>
        ) : showList ? (
          <>
            <div className="grid gap-3">
              {repos!.map((repo) => (
                <RepoCard
                  key={`${repo.selectedMaintainer}:${repo.dTag}`}
                  repo={repo}
                  isUserMatch={repo.maintainerSet.some((pk) =>
                    matchedUserPubkeys.has(pk),
                  )}
                />
              ))}
            </div>

            {/* Infinite scroll sentinel — only in browse mode */}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-8">
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                ) : (
                  <div className="h-5 w-5" />
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

interface RepoCardProps {
  repo: ResolvedRepo;
  /** True when a maintainer of this repo matched the NIP-50 user search. */
  isUserMatch?: boolean;
}

function RepoCard({ repo, isUserMatch }: RepoCardProps) {
  const repoPath = useRepoPath(repo.selectedMaintainer, repo.dTag, repo.relays);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  // Prefetch NIP-05 identities for all maintainers. UserLink already subscribes
  // to each maintainer's User cast for the avatar, so this is effectively free.
  usePrefetchNip05(repo.maintainerSet);

  return (
    <Link to={repoPath} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-pink-500/10 to-pink-500/10">
                  <GitBranch className="h-4 w-4 text-pink-500" />
                </div>
                <h3 className="font-semibold text-base truncate group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  {repo.name}
                </h3>
                {isUserMatch && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0"
                    title="Maintainer matched your search"
                  >
                    <User className="h-2.5 w-2.5" />
                    user match
                  </span>
                )}
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
              <ExternalLink className="h-4 w-4 text-muted-foreground/40 group-hover:text-pink-500 transition-colors shrink-0 mt-1" />
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Relay pills
// ---------------------------------------------------------------------------

/** Single relay pill with a live connection-status dot. */
function RelayPill({ relayUrl }: { relayUrl: string }) {
  const inst = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const connected = use$(() => inst.connected$, [inst]);

  const label = relayUrl.replace(/^wss?:\/\//, "").replace(/\/$/, "");

  // Three states: undefined = connecting, true = connected, false = disconnected
  const dotClass =
    connected === undefined
      ? "bg-amber-400"
      : connected
        ? "bg-green-500"
        : "bg-muted-foreground/40";

  const title =
    connected === undefined
      ? `${relayUrl} — connecting…`
      : connected
        ? `${relayUrl} — connected`
        : `${relayUrl} — disconnected`;

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono text-muted-foreground bg-muted/60 border border-border/50 select-none"
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      {label}
    </span>
  );
}

/** Row of relay pills shown below the search box. */
function RelayPillsRow({ relayOverride }: { relayOverride?: string[] }) {
  const liveGitIndexRelays =
    use$(() => gitIndexRelays, []) ?? gitIndexRelays.getValue();
  const relays = relayOverride ?? liveGitIndexRelays;

  if (relays.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground/60 mr-0.5">
        Searching:
      </span>
      {relays.map((url) => (
        <RelayPill key={url} relayUrl={url} />
      ))}
    </div>
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
