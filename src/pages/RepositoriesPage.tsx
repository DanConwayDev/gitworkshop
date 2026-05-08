import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type React from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  const [searchParams, setSearchParams] = useSearchParams();

  // `committedQuery` is what actually gets sent to the relay.
  // `inputValue` is the live text in the input box.
  // They diverge while the user is typing — the query only commits on Enter
  // or after 800ms of inactivity.
  const committedQuery = searchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(committedQuery);

  const commitQuery = useCallback(
    (value: string) => {
      setSearchParams(value.trim() ? { q: value.trim() } : {}, {
        replace: true,
      });
    },
    [setSearchParams],
  );

  // 800ms debounce fallback — fires if the user stops typing without pressing Enter.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitQuery(val), 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      commitQuery(inputValue);
    }
  };

  // Keep inputValue in sync if the URL changes externally (e.g. back/forward).
  const prevCommittedRef = useRef(committedQuery);
  useEffect(() => {
    if (committedQuery !== prevCommittedRef.current) {
      prevCommittedRef.current = committedQuery;
      setInputValue(committedQuery);
    }
  }, [committedQuery]);

  const { repos, isLoading, hasMore, loadMore, matchedUserPubkeys } =
    useRepositorySearch(committedQuery, relayOverride);

  const title = relayLabel
    ? `Repositories on ${relayLabel} - ngit`
    : "Repositories - ngit";

  useSeoMeta({
    title,
    description: relayLabel
      ? `Browse git repositories on ${relayLabel}`
      : "Browse git repositories on Nostr",
    ogImage: "/og-image.svg",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    twitterCard: "summary_large_image",
  });

  // Keep a stable ref to the latest loadMore/hasMore/isLoading so the
  // IntersectionObserver never needs to be torn down and recreated — tearing
  // it down causes it to miss the intersection that triggered the re-render.
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Callback ref — fires whenever the sentinel mounts/unmounts, so the
  // observer is always attached even though the element renders conditionally.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const setSentinelRef = useCallback((el: HTMLDivElement | null) => {
    // Disconnect any previous observer
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMoreRef.current &&
          !isLoadingRef.current
        ) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    observerRef.current = observer;
  }, []);

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
                placeholder="Search repositories… (Enter or pause to search)"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
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
                {committedQuery
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

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={setSentinelRef} className="flex justify-center py-8">
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
