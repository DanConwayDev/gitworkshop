import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { repoToPath } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import { useActiveAccount } from "applesauce-react/hooks";
import { useRepoContext } from "./RepoContext";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusTabs } from "@/components/StatusTabs";
import { LabelBadge } from "@/components/LabelBadge";
import { CreateIssueForm } from "@/components/CreateIssueForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  CircleDot,
  X,
  Plus,
} from "lucide-react";
import type { IssueStatus, ResolvedIssue } from "@/lib/nip34";

const DEFAULT_STATUS_FILTER: IssueStatus[] = ["open", "draft"];

export default function RepoIssuesPage() {
  const { pubkey, repoId, resolved, issues } = useRepoContext();
  const repo = resolved?.repo;
  const account = useActiveAccount();

  // New issue dialog
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  // Filters — all multi-select; status defaults to open+draft
  const [statusFilter, setStatusFilter] = useState<IssueStatus[]>(
    DEFAULT_STATUS_FILTER,
  );
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
    if (issues) {
      for (const issue of issues) {
        counts[issue.status]++;
      }
    }
    return counts;
  }, [issues]);

  // Collect all unique labels and authors from resolved issues.
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

  const labelOptions: MultiSelectOption[] = allLabels.map((l) => ({
    value: l,
    label: l,
  }));

  // Apply filters
  const filteredIssues = useMemo(() => {
    if (!issues) return undefined;
    return issues.filter((issue) => {
      if (statusFilter.length > 0 && !statusFilter.includes(issue.status))
        return false;
      if (
        labelFilter.length > 0 &&
        !labelFilter.some((l) => issue.labels.includes(l))
      )
        return false;
      if (authorFilter && issue.pubkey !== authorFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !issue.currentSubject.toLowerCase().includes(q) &&
          !issue.originalSubject.toLowerCase().includes(q) &&
          !issue.content.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [issues, statusFilter, labelFilter, authorFilter, searchQuery]);

  // "Active" means filters differ from the default state
  const hasActiveFilters =
    statusFilter.length !== DEFAULT_STATUS_FILTER.length ||
    !DEFAULT_STATUS_FILTER.every((s) => statusFilter.includes(s)) ||
    labelFilter.length > 0 ||
    !!authorFilter ||
    searchQuery.trim().length > 0;

  const clearFilters = () => {
    setStatusFilter(DEFAULT_STATUS_FILTER);
    setLabelFilter([]);
    setAuthorFilter(null);
    setSearchQuery("");
  };

  useSeoMeta({
    title: repo ? `Issues - ${repo.name} - ngit` : "Repository Issues - ngit",
    description: repo?.description ?? "Browse issues for this repository",
  });

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {/* New Issue Dialog */}
      {repo && (
        <Dialog open={newIssueOpen} onOpenChange={setNewIssueOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-violet-500" />
                New Issue
              </DialogTitle>
              <DialogDescription>
                Submit a bug report, feature request, or question for{" "}
                <span className="font-medium text-foreground">{repo.name}</span>
                .
              </DialogDescription>
            </DialogHeader>
            <CreateIssueForm
              repoCoord={repo.allCoordinates[0]}
              ownerPubkey={repo.selectedMaintainer}
              onSuccess={() => setNewIssueOpen(false)}
              onCancel={() => setNewIssueOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Search + filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background/60"
          />
        </div>

        <div className="flex gap-2 flex-wrap items-center ml-auto">
          {account && repo && (
            <Button
              size="sm"
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white h-9"
              onClick={() => setNewIssueOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Issue
            </Button>
          )}

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
        className="mb-3"
      />

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
                : "Be the first to open an issue"}
            </p>
            {!hasActiveFilters && account && repo && (
              <Button
                size="sm"
                className="mt-4 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => setNewIssueOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New Issue
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredIssues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
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

function IssueRow({
  issue,
  repoPath,
}: {
  issue: ResolvedIssue;
  repoPath: string;
}) {
  const timeAgo = formatDistanceToNow(new Date(issue.createdAt * 1000), {
    addSuffix: true,
  });

  return (
    <Link to={`${repoPath}/issues/${issue.id}`} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-violet-500/5 hover:border-violet-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <StatusBadge status={issue.status} />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-[15px] group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors mb-1.5 line-clamp-1">
                {issue.currentSubject}
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
              <div className="flex items-center gap-2.5 text-muted-foreground/60">
                {issue.commentCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs"
                    title={`${issue.commentCount} comments`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{issue.commentCount}</span>
                  </div>
                )}
                {issue.zapCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs text-amber-500/70"
                    title={`${issue.zapCount} zaps`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>{issue.zapCount}</span>
                  </div>
                )}
                {issue.participantCount > 0 && (
                  <div
                    className="flex items-center gap-1 text-xs"
                    title={`${issue.participantCount} participants`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>{issue.participantCount}</span>
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
