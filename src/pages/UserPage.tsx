import { Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { useProfile } from "@/hooks/useProfile";
import { useUserRepositories } from "@/hooks/useUserRepositories";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  ExternalLink,
  Globe,
  Zap,
  Copy,
  Check,
  ArrowLeft,
} from "lucide-react";
import { useState } from "react";
import type { ResolvedRepo } from "@/lib/nip34";

interface UserPageProps {
  pubkey: string;
}

export default function UserPage({ pubkey }: UserPageProps) {
  const profile = useProfile(pubkey);
  const repos = useUserRepositories(pubkey);
  const npub = nip19.npubEncode(pubkey);

  const displayName =
    profile?.displayName ?? profile?.name ?? npub.slice(0, 16) + "...";

  useSeoMeta({
    title: profile ? `${displayName} - ngit` : "User Profile - ngit",
    description: profile?.about ?? "Nostr user profile",
  });

  return (
    <div className="min-h-screen">
      {/* Profile header */}
      <div className="relative isolate border-b border-border/40">
        {/* Banner */}
        {profile?.banner ? (
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <img
              src={profile.banner}
              alt=""
              className="w-full h-full object-cover opacity-15 dark:opacity-10"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
          </div>
        ) : (
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />
        )}

        <div className="container max-w-screen-xl px-4 md:px-8 py-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All repositories
          </Link>

          <div className="flex flex-col md:flex-row gap-6 md:gap-8">
            {/* Avatar */}
            <div className="shrink-0">
              {profile ? (
                <UserAvatar
                  pubkey={pubkey}
                  size="lg"
                  className="h-20 w-20 md:h-24 md:w-24 text-2xl ring-4 ring-background shadow-xl"
                />
              ) : (
                <Skeleton className="h-20 w-20 md:h-24 md:w-24 rounded-full" />
              )}
            </div>

            {/* Profile info */}
            <div className="flex-1 min-w-0">
              {profile ? (
                <>
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
                    {displayName}
                  </h1>

                  {profile.name &&
                    profile.displayName &&
                    profile.name !== profile.displayName && (
                      <p className="text-muted-foreground text-sm mb-2">
                        @{profile.name}
                      </p>
                    )}

                  {profile.about && (
                    <p className="text-muted-foreground max-w-2xl mb-4 leading-relaxed">
                      {profile.about}
                    </p>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    {profile.nip05 && (
                      <span className="text-sm text-violet-600 dark:text-violet-400 font-medium">
                        {profile.nip05}
                      </span>
                    )}

                    {profile.website && (
                      <a
                        href={
                          profile.website.startsWith("http")
                            ? profile.website
                            : `https://${profile.website}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        {profile.website
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, "")}
                      </a>
                    )}

                    {(profile.lud16 || profile.lud06) && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-amber-500">
                        <Zap className="h-3.5 w-3.5" />
                        Lightning
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-96" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              )}

              {/* Npub copy */}
              <div className="mt-4">
                <CopyNpub npub={npub} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Repositories section */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-8">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="p-1.5 rounded-md bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
            <GitBranch className="h-4 w-4 text-violet-500" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Repositories</h2>
          {repos && (
            <Badge variant="secondary" className="text-xs">
              {repos.length}
            </Badge>
          )}
        </div>

        {!repos ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <RepoSkeleton key={i} />
            ))}
          </div>
        ) : repos.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">
                No repository announcements found for this user.
              </p>
              <p className="text-muted-foreground/60 text-sm mt-1">
                They may not have published any repositories yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {repos.map((repo) => (
              <UserRepoCard
                key={`${repo.selectedMaintainer}:${repo.dTag}`}
                repo={repo}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRepoCard({ repo }: { repo: ResolvedRepo }) {
  const npub = nip19.npubEncode(repo.selectedMaintainer);
  const timeAgo = formatDistanceToNow(new Date(repo.updatedAt * 1000), {
    addSuffix: true,
  });

  // Co-maintainers (excluding the page owner who is the selectedMaintainer)
  const coMaintainers = repo.maintainerSet.filter(
    (pk) => pk !== repo.selectedMaintainer,
  );

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
                {coMaintainers.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {coMaintainers.slice(0, 2).map((pk) => (
                      <UserAvatar key={pk} pubkey={pk} size="sm" />
                    ))}
                    <span className="text-xs text-muted-foreground">
                      +{coMaintainers.length} co-maintainer
                      {coMaintainers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}

                <span className="text-xs text-muted-foreground/60">
                  {timeAgo}
                </span>

                {repo.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {repo.labels.slice(0, 4).map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-5"
                      >
                        {label}
                      </Badge>
                    ))}
                    {repo.labels.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{repo.labels.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {repo.webUrls.length > 0 && (
              <a
                href={repo.webUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/40 group-hover:text-violet-500 transition-colors shrink-0 mt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CopyNpub({ npub }: { npub: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs font-mono text-muted-foreground gap-1.5"
      onClick={handleCopy}
    >
      {npub.slice(0, 12)}...{npub.slice(-4)}
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
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
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
