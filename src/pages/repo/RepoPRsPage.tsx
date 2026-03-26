import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { repoToPath, eventIdToNevent } from "@/lib/routeUtils";
import { useSeoMeta } from "@unhead/react";
import { formatDistanceToNow } from "date-fns";
import { useRepoContext } from "./RepoContext";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { StatusIcon } from "@/components/StatusIcon";
import { StatusTabs } from "@/components/StatusTabs";
import { LabelBadge } from "@/components/LabelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { Search, MessageCircle, Users, X } from "lucide-react";
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

      {/* Bordered container with status tabs header + list */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header bar: status tabs */}
        <div className="flex items-center bg-muted/40 px-3 py-1.5 overflow-x-auto">
          <StatusTabs
            counts={statusCounts}
            selected={statusFilter}
            onChange={(v) => setStatusFilter(v as IssueStatus[])}
            variant="pr"
            className="border-b-0 pb-0 mb-0 flex-1"
          />
        </div>

        {/* PR list */}
        {!filteredPRs ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <PRSkeleton key={i} />
            ))}
          </ul>
        ) : filteredPRs.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">
              {hasActiveFilters
                ? "No PRs match your filters"
                : "No pull requests yet"}
            </p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {hasActiveFilters
                ? "Try adjusting your filters"
                : "Pull requests and patches will appear here"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filteredPRs.map((pr) => (
              <PRRow
                key={pr.id}
                pr={pr}
                repoPath={repoToPath(pubkey, repoId, repo?.relays ?? [])}
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

function PRRow({
  pr,
  repoPath,
  repoRelays,
}: {
  pr: ResolvedPR;
  repoPath: string;
  repoRelays: string[];
}) {
  const lastActive = formatDistanceToNow(new Date(pr.lastActivityAt * 1000), {
    addSuffix: true,
  });

  const nevent = eventIdToNevent(pr.id, repoRelays);

  return (
    <li className="group hover:bg-accent/40 transition-colors">
      <Link
        to={`${repoPath}/prs/${nevent}`}
        className="flex items-start gap-3 px-3 py-2.5 text-sm"
      >
        {/* Status icon — variant reflects PR vs patch */}
        <StatusIcon
          status={pr.status}
          variant={pr.itemType === "patch" ? "patch" : "pr"}
          className="mt-0.5"
        />

        {/* Title + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors line-clamp-1">
              {pr.currentSubject}
            </span>
            {pr.labels.map((label) => (
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
              pubkey={pr.pubkey}
              size="sm"
              className="h-4 w-4 text-[8px]"
            />
            <UserName
              pubkey={pr.pubkey}
              className="text-xs font-normal text-muted-foreground"
            />
          </div>
        </div>

        {/* Comment & participant counts — right-aligned */}
        <div className="flex items-center gap-3 self-center text-xs text-muted-foreground shrink-0">
          {pr.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <MessageCircle className="h-3 w-3" />
              {pr.commentCount}
            </span>
          )}
          {pr.participantCount > 1 && (
            <span className="inline-flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {pr.participantCount}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function PRSkeleton() {
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
