import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { useRepositories } from "@/hooks/useRepositories";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Search, ExternalLink, Sparkles } from "lucide-react";
import type { Repository } from "@/casts/Repository";
import { formatDistanceToNow } from "date-fns";

export default function RepositoriesPage() {
  useSeoMeta({
    title: "Repositories - ngit Issue Tracker",
    description: "Browse git repositories on Nostr",
  });

  const repos = useRepositories();
  const [search, setSearch] = useState("");

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
              Powered by Nostr
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-600 dark:from-violet-400 dark:via-fuchsia-400 dark:to-violet-400 bg-clip-text text-transparent">
              Git Repositories
            </span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mb-8">
            Decentralized code collaboration. Browse repositories, track issues,
            and contribute -- all over Nostr.
          </p>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-background/60 backdrop-blur-sm border-border/60 focus-visible:ring-violet-500/30"
            />
          </div>
        </div>
      </div>

      {/* Repository list */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        {!filtered ? (
          <div className="grid gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <RepoSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
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
        ) : (
          <div className="grid gap-3">
            {filtered.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RepoCard({ repo }: { repo: Repository }) {
  const npub = nip19.npubEncode(repo.pubkey);
  const timeAgo = formatDistanceToNow(repo.createdAt, { addSuffix: true });

  return (
    <Link to={`/${npub}/${repo.dTag}`} className="group block">
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
                <div className="flex items-center gap-1.5">
                  <UserAvatar pubkey={repo.pubkey} size="sm" />
                  <UserName
                    pubkey={repo.pubkey}
                    className="text-xs text-muted-foreground"
                  />
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
