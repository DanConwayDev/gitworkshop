import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { useResolvedRepository } from "@/hooks/useResolvedRepository";
import { useIssues } from "@/hooks/useIssues";
import { useNip34Loaders } from "@/hooks/useNip34Loaders";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { map } from "rxjs/operators";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GitBranch,
  Search,
  MessageCircle,
  Zap,
  Users,
  CircleDot,
  ArrowLeft,
  ExternalLink,
  Filter,
  X,
} from "lucide-react";
import { NGIT_RELAYS, COMMENT_KIND, type IssueStatus } from "@/lib/nip34";
import type { Filter as NostrFilter } from "applesauce-core/helpers";
import type { Observable } from "rxjs";
import type { Issue } from "@/casts/Issue";

export default function RepoPage() {
  const { npub, repoId } = useParams<{ npub: string; repoId: string }>();

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

  const repo = useResolvedRepository(pubkey, repoId);
  const { issues, statusMap } = useIssues(repo?.allCoordinates);

  // Filters
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Collect all unique labels and authors from issues
  const { allLabels, allAuthors } = useMemo(() => {
    if (!issues) return { allLabels: [], allAuthors: [] };
    const labels = new Set<string>();
    const authors = new Set<string>();
    for (const issue of issues) {
      issue.labels.forEach((l) => labels.add(l));
      authors.add(issue.pubkey);
    }
    return {
      allLabels: Array.from(labels).sort(),
      allAuthors: Array.from(authors),
    };
  }, [issues]);

  // Apply filters
  const filteredIssues = useMemo(() => {
    if (!issues) return undefined;
    return issues.filter((issue) => {
      // Status filter
      if (statusFilter !== "all") {
        const issueStatus = statusMap.get(issue.id)?.status ?? "open";
        if (issueStatus !== statusFilter) return false;
      }

      // Label filter
      if (labelFilter && !issue.labels.includes(labelFilter)) return false;

      // Author filter
      if (authorFilter && issue.pubkey !== authorFilter) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !issue.subject.toLowerCase().includes(q) &&
          !issue.content.toLowerCase().includes(q)
        )
          return false;
      }

      return true;
    });
  }, [issues, statusFilter, labelFilter, authorFilter, searchQuery, statusMap]);

  const hasActiveFilters =
    statusFilter !== "all" || labelFilter || authorFilter || searchQuery;

  useSeoMeta({
    title: repo ? `Issues - ${repo.name} - ngit` : "Repository Issues - ngit",
    description: repo?.description ?? "Browse issues for this repository",
  });

  return (
    <div className="min-h-screen">
      {/* Repo header */}
      <div className="relative isolate border-b border-border/40">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5" />

        <div className="container max-w-screen-xl px-4 md:px-8 py-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All repositories
          </Link>

          {repo ? (
            <div>
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
                <div className="flex items-center gap-1.5">
                  <UserAvatar pubkey={repo.selectedMaintainer} size="sm" />
                  <UserName
                    pubkey={repo.selectedMaintainer}
                    className="text-sm text-muted-foreground"
                  />
                  {repo.maintainerSet.length > 1 && (
                    <span className="text-sm text-muted-foreground/60">
                      +{repo.maintainerSet.length - 1} maintainers
                    </span>
                  )}
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
            <div className="space-y-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-5 w-96" />
              <div className="flex gap-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters + Issues */}
      <div className="container max-w-screen-xl px-4 md:px-8 py-6">
        {/* Filter bar */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search issues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-background/60"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as IssueStatus | "all")}
            >
              <SelectTrigger className="w-[130px] h-9 text-sm">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>

            {allLabels.length > 0 && (
              <Select
                value={labelFilter ?? "__all__"}
                onValueChange={(v) =>
                  setLabelFilter(v === "__all__" ? null : v)
                }
              >
                <SelectTrigger className="w-[140px] h-9 text-sm">
                  <SelectValue placeholder="Label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Labels</SelectItem>
                  {allLabels.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {allAuthors.length > 1 && (
              <Select
                value={authorFilter ?? "__all__"}
                onValueChange={(v) =>
                  setAuthorFilter(v === "__all__" ? null : v)
                }
              >
                <SelectTrigger className="w-[160px] h-9 text-sm">
                  <SelectValue placeholder="Author" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Authors</SelectItem>
                  {allAuthors.map((pubkey) => (
                    <SelectItem key={pubkey} value={pubkey}>
                      <AuthorSelectLabel pubkey={pubkey} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStatusFilter("all");
                  setLabelFilter(null);
                  setAuthorFilter(null);
                  setSearchQuery("");
                }}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Issue count */}
        {filteredIssues && (
          <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
            <CircleDot className="h-4 w-4" />
            <span>
              {filteredIssues.length}{" "}
              {filteredIssues.length === 1 ? "issue" : "issues"}
              {hasActiveFilters && " (filtered)"}
            </span>
          </div>
        )}

        {/* Issue list */}
        {!filteredIssues ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <IssueSkeleton key={i} />
            ))}
          </div>
        ) : filteredIssues.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <CircleDot className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground text-lg">
                {hasActiveFilters
                  ? "No issues match your filters"
                  : "No issues yet"}
              </p>
              <p className="text-muted-foreground/60 text-sm mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "This repository has no issues"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                status={statusMap.get(issue.id)?.status ?? "open"}
                npub={npub!}
                repoId={repoId!}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthorSelectLabel({ pubkey }: { pubkey: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <UserAvatar pubkey={pubkey} size="sm" />
      <UserName pubkey={pubkey} className="text-sm" />
    </div>
  );
}

function IssueRow({
  issue,
  status,
  npub,
  repoId,
}: {
  issue: Issue;
  status: IssueStatus;
  npub: string;
  repoId: string;
}) {
  const timeAgo = formatDistanceToNow(issue.createdAt, { addSuffix: true });

  // Trigger two-tier loading for this issue. All IssueRow calls within the
  // same render cycle are batched by the loaders into a small number of relay
  // subscriptions (one per kind group, not one per issue).
  useNip34Loaders(issue.id, NGIT_RELAYS);

  return (
    <Link to={`/${npub}/${repoId}/${issue.id}`} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <StatusBadge status={status} />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-[15px] group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors mb-1.5 line-clamp-1">
                {issue.subject}
              </h3>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <UserAvatar pubkey={issue.pubkey} size="sm" />
                  <UserName
                    pubkey={issue.pubkey}
                    className="text-xs text-muted-foreground"
                  />
                </div>

                <span className="text-xs text-muted-foreground/60">
                  {timeAgo}
                </span>

                {issue.labels.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {issue.labels.map((label) => (
                      <LabelBadge key={label} label={label} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <IssueStats issueId={issue.id} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Reads comment count, zap count, and participant count for an issue from the
 * store. Loading is triggered by useNip34Loaders in the parent IssueRow.
 */
function IssueStats({ issueId }: { issueId: string }) {
  const store = useEventStore();
  const issueIdKey = issueId;

  const commentCount =
    use$(() => {
      const filter = { kinds: [COMMENT_KIND], "#E": [issueId] } as NostrFilter;
      return store.timeline([filter]).pipe(map((events) => events.length));
    }, [issueIdKey, store]) ?? 0;

  const zapCount =
    use$(() => {
      const filter = { kinds: [9735], "#e": [issueId] } as NostrFilter;
      return store.timeline([filter]).pipe(map((events) => events.length));
    }, [issueIdKey, store]) ?? 0;

  const participantCount =
    use$(() => {
      const filter = { kinds: [COMMENT_KIND], "#E": [issueId] } as NostrFilter;
      return store
        .timeline([filter])
        .pipe(map((events) => new Set(events.map((e) => e.pubkey)).size));
    }, [issueIdKey, store]) ?? 0;

  return (
    <div className="flex items-center gap-2.5 text-muted-foreground/60">
      {commentCount > 0 && (
        <div
          className="flex items-center gap-1 text-xs"
          title={`${commentCount} comments`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span>{commentCount}</span>
        </div>
      )}
      {zapCount > 0 && (
        <div
          className="flex items-center gap-1 text-xs text-amber-500/70"
          title={`${zapCount} zaps`}
        >
          <Zap className="h-3.5 w-3.5" />
          <span>{zapCount}</span>
        </div>
      )}
      {participantCount > 0 && (
        <div
          className="flex items-center gap-1 text-xs"
          title={`${participantCount} participants`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>{participantCount}</span>
        </div>
      )}
    </div>
  );
}

function IssueSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-6 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <div className="flex gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-8" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
