import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { repoToPath } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import { useRepoContext } from "./RepoContext";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusTabs } from "@/components/StatusTabs";
import { LabelBadge } from "@/components/LabelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import type { MultiSelectOption } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MessageCircle,
  Zap,
  Users,
  GitPullRequest,
  GitCommitHorizontal,
  X,
} from "lucide-react";
import type { IssueStatus, ResolvedPR, PRItemType } from "@/lib/nip34";

const TYPE_OPTIONS: MultiSelectOption[] = [
  { value: "pr", label: "Pull Requests" },
  { value: "patch", label: "Patches" },
];

const DEFAULT_STATUS_FILTER: IssueStatus[] = ["open", "draft"];

export default function RepoPRsPage() {
  const { pubkey, repoId, resolved, prs } = useRepoContext();
  const repo = resolved?.repo;

  // Filters — all multi-select; status defaults to open+draft
  const [statusFilter, setStatusFilter] = useState<IssueStatus[]>(
    DEFAULT_STATUS_FILTER,
  );
  const [typeFilter, setTypeFilter] = useState<PRItemType[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Compute per-status counts from the full (unfiltered) list.
  const statusCounts = useMemo(() => {
    const counts: Record<IssueStatus, number> = {
      open: 0,
      draft: 0,
      resolved: 0,
      closed: 0,
      deleted: 0,
    };
    if (prs) {
      for (const pr of prs) {
        counts[pr.status]++;
      }
    }
    return counts;
  }, [prs]);

  // Collect all unique labels and authors from resolved PRs.
  const { allLabels, allAuthors } = useMemo(() => {
    if (!prs) return { allLabels: [], allAuthors: [] };
    const labels = new Set<string>();
    const authors = new Set<string>();
    for (const pr of prs) {
      pr.labels.forEach((l) => labels.add(l));
      authors.add(pr.pubkey);
    }
    return {
      allLabels: Array.from(labels).sort(),
      allAuthors: Array.from(authors),
    };
  }, [prs]);

  const labelOptions: MultiSelectOption[] = allLabels.map((l) => ({
    value: l,
    label: l,
  }));

  // Apply filters
  const filteredPRs = useMemo(() => {
    if (!prs) return undefined;
    return prs.filter((pr) => {
      if (statusFilter.length > 0 && !statusFilter.includes(pr.status))
        return false;
      if (typeFilter.length > 0 && !typeFilter.includes(pr.itemType))
        return false;
      if (
        labelFilter.length > 0 &&
        !labelFilter.some((l) => pr.labels.includes(l))
      )
        return false;
      if (authorFilter && pr.pubkey !== authorFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !pr.currentSubject.toLowerCase().includes(q) &&
          !pr.originalSubject.toLowerCase().includes(q) &&
          !pr.content.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [prs, statusFilter, typeFilter, labelFilter, authorFilter, searchQuery]);

  // "Active" means filters differ from the default state
  const hasActiveFilters =
    statusFilter.length !== DEFAULT_STATUS_FILTER.length ||
    !DEFAULT_STATUS_FILTER.every((s) => statusFilter.includes(s)) ||
    typeFilter.length > 0 ||
    labelFilter.length > 0 ||
    !!authorFilter ||
    searchQuery.trim().length > 0;

  const clearFilters = () => {
    setStatusFilter(DEFAULT_STATUS_FILTER);
    setTypeFilter([]);
    setLabelFilter([]);
    setAuthorFilter(null);
    setSearchQuery("");
  };

  useSeoMeta({
    title: repo ? `PRs - ${repo.name} - ngit` : "Pull Requests - ngit",
    description:
      repo?.description ?? "Browse pull requests for this repository",
  });

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {/* Search + filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PRs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background/60"
          />
        </div>

        <div className="flex gap-2 flex-wrap items-center ml-auto">
          <MultiSelect
            options={TYPE_OPTIONS}
            selected={typeFilter}
            onChange={(v) => setTypeFilter(v as PRItemType[])}
            placeholder="Type"
            className="w-[140px]"
          />

          {allLabels.length > 0 && (
            <MultiSelect
              options={labelOptions}
              selected={labelFilter}
              onChange={setLabelFilter}
              placeholder="Label"
              className="w-[150px]"
            />
          )}

          {allAuthors.length > 1 && (
            <Select
              value={authorFilter ?? "__all__"}
              onValueChange={(v) => setAuthorFilter(v === "__all__" ? null : v)}
            >
              <SelectTrigger className="w-[160px] h-9 text-sm">
                <SelectValue placeholder="Author" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Authors</SelectItem>
                {allAuthors.map((pk) => (
                  <SelectItem key={pk} value={pk}>
                    <AuthorSelectLabel pubkey={pk} />
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
              onClick={clearFilters}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <StatusTabs
        counts={statusCounts}
        selected={statusFilter}
        onChange={(v) => setStatusFilter(v as IssueStatus[])}
        variant="pr"
        className="mb-3"
      />

      {/* PR list */}
      {!filteredPRs ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <PRSkeleton key={i} />
          ))}
        </div>
      ) : filteredPRs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <GitPullRequest className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground text-lg">
              {hasActiveFilters
                ? "No PRs match your filters"
                : "No pull requests yet"}
            </p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {hasActiveFilters
                ? "Try adjusting your filters"
                : "Pull requests and patches will appear here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredPRs.map((pr) => (
            <PRRow
              key={pr.id}
              pr={pr}
              repoPath={repoToPath(pubkey, repoId, repo?.relays ?? [])}
            />
          ))}
        </div>
      )}
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

function PRRow({ pr, repoPath }: { pr: ResolvedPR; repoPath: string }) {
  const timeAgo = formatDistanceToNow(new Date(pr.createdAt * 1000), {
    addSuffix: true,
  });

  const TypeIcon =
    pr.itemType === "patch" ? GitCommitHorizontal : GitPullRequest;

  return (
    <Link to={`${repoPath}/prs/${pr.id}`} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <StatusBadge status={pr.status} variant="pr" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <h3 className="font-medium text-[15px] group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors line-clamp-1">
                  {pr.currentSubject}
                </h3>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <UserAvatar pubkey={pr.pubkey} size="sm" />
                  <UserName
                    pubkey={pr.pubkey}
                    className="text-xs text-muted-foreground"
                  />
                </div>

                <span className="text-xs text-muted-foreground/60">
                  {timeAgo}
                </span>

                {pr.labels.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {pr.labels.map((label) => (
                      <LabelBadge key={label} label={label} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2.5 text-muted-foreground/60">
                {pr.commentCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs"
                    title={`${pr.commentCount} comments`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{pr.commentCount}</span>
                  </div>
                )}
                {pr.zapCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs text-amber-500/70"
                    title={`${pr.zapCount} zaps`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>{pr.zapCount}</span>
                  </div>
                )}
                {pr.participantCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs"
                    title={`${pr.participantCount} participants`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>{pr.participantCount}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PRSkeleton() {
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
