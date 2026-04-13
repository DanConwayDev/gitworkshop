import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { repoToPath, eventIdToNevent } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import { useActiveAccount } from "applesauce-react/hooks";
import { useRepoContext } from "./RepoContext";
import { UserName } from "@/components/UserAvatar";
import { StatusIcon } from "@/components/StatusIcon";
import { StatusTabs } from "@/components/StatusTabs";
import { LabelBadge } from "@/components/LabelBadge";
import { CreateIssueForm } from "@/components/CreateIssueForm";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { Search, MessageCircle, Users, CircleDot, X, Plus } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import type { IssueStatus, ResolvedIssueLite } from "@/lib/nip34";

const DEFAULT_STATUS_FILTER: IssueStatus[] = ["open"];

export default function RepoIssuesPage() {
  const { pubkey, repoId, resolved, issues, nip05 } = useRepoContext();
  const repo = resolved?.repo;
  const account = useActiveAccount();

  // New issue dialog
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  // Filters — all multi-select; status defaults to open
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
                <CircleDot className="h-4 w-4 text-pink-500" />
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

      {/* Bordered container with status tabs header + list */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header bar: status tabs + new issue button */}
        <div className="flex items-center bg-muted/40 px-3 py-1.5 overflow-x-auto">
          <StatusTabs
            counts={statusCounts}
            selected={statusFilter}
            onChange={(v) => setStatusFilter(v as IssueStatus[])}
            className="border-b-0 pb-0 mb-0 flex-1"
          />
          {account && repo && (
            <Button
              size="sm"
              className="gap-1.5 bg-pink-600 hover:bg-pink-700 text-white h-8 text-xs shrink-0 ml-2"
              onClick={() => setNewIssueOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Issue
            </Button>
          )}
        </div>

        {/* Issue list */}
        {!filteredIssues ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <IssueSkeleton key={i} />
            ))}
          </ul>
        ) : filteredIssues.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">
              {hasActiveFilters
                ? "No issues match your filters"
                : "No issues yet"}
            </p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {hasActiveFilters
                ? "Try adjusting your filters"
                : "Be the first to open an issue"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filteredIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                repoPath={repoToPath(pubkey, repoId, repo?.relays ?? [], nip05)}
                repoRelays={repo?.relays ?? []}
              />
            ))}
          </ul>
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
  repoPath,
  repoRelays,
}: {
  issue: ResolvedIssueLite;
  repoPath: string;
  repoRelays: string[];
}) {
  const lastActive = formatDistanceToNow(
    new Date(issue.lastActivityAt * 1000),
    { addSuffix: true },
  );

  const nevent = eventIdToNevent(issue.id, repoRelays.slice(0, 1));

  return (
    <li className="group hover:bg-accent/40 transition-colors">
      <Link
        to={`${repoPath}/issues/${nevent}`}
        className="flex items-start gap-3 px-3 py-2.5 text-sm"
      >
        {/* Status icon */}
        <StatusIcon status={issue.status} className="mt-0.5" />

        {/* Title + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors line-clamp-1">
              {issue.currentSubject}
            </span>
            {issue.labels.map((label) => (
              <LabelBadge
                key={label}
                label={label}
                className="text-[10px] py-0 px-1.5 h-[18px]"
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>active {lastActive}</span>
            <span className="text-muted-foreground/40">&middot;</span>
            <UserAvatar
              pubkey={issue.pubkey}
              size="sm"
              className="h-4 w-4 text-[8px]"
            />
            <UserName
              pubkey={issue.pubkey}
              className="text-xs font-normal text-muted-foreground"
            />
          </div>
        </div>

        {/* Comment & participant counts — right-aligned */}
        <div className="flex items-center gap-3 self-center text-xs text-muted-foreground shrink-0">
          {issue.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <MessageCircle className="h-3 w-3" />
              {issue.commentCount}
            </span>
          )}
          {issue.participantCount > 1 && (
            <span className="inline-flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {issue.participantCount}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function IssueSkeleton() {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Skeleton className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </li>
  );
}
