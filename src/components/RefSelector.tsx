import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitBranch,
  Tag,
  Check,
  ChevronsUpDown,
  Search,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefSelectorProps {
  refs: GitRef[];
  currentRef: string;
  onRefChange: (ref: string) => void;
  /** The winning Nostr state event, null if none found, undefined while loading */
  repoState: RepositoryState | null | undefined;
  /** True once the relay EOSE has been received for the state query */
  repoRelayEose: boolean;
  /** True while data is still being fetched */
  loading?: boolean;
}

/**
 * Status of a ref's verification against the signed state event.
 *
 * - "verified"   : state event exists and this ref's commit matches
 * - "mismatch"   : state event exists but declares a different commit for this ref
 * - "untracked"  : state event exists but doesn't include this ref
 * - "no-state"   : no state event was found (after EOSE)
 * - "loading"    : still waiting for state event data
 */
type RefStatus = "verified" | "mismatch" | "untracked" | "no-state" | "loading";

interface RefWithStatus extends GitRef {
  status: RefStatus;
  stateCommit?: string; // commit declared by state event (if different)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRefStatus(
  ref: GitRef,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
): { status: RefStatus; stateCommit?: string } {
  // Still loading state event data
  if (repoState === undefined || !repoRelayEose) {
    return { status: "loading" };
  }

  // No state event found
  if (repoState === null) {
    return { status: "no-state" };
  }

  // Find this ref in the state event
  const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${ref.name}`;
  const stateRef = repoState.refs.find((r) => r.name === fullRefName);

  if (!stateRef) {
    return { status: "untracked" };
  }

  // Compare commits (handle both full and abbreviated hashes)
  if (
    ref.hash === stateRef.commitId ||
    ref.hash.startsWith(stateRef.commitId) ||
    stateRef.commitId.startsWith(ref.hash)
  ) {
    return { status: "verified" };
  }

  return { status: "mismatch", stateCommit: stateRef.commitId };
}

function countMismatches(refsWithStatus: RefWithStatus[]): number {
  return refsWithStatus.filter((r) => r.status === "mismatch").length;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
  className,
}: {
  status: RefStatus;
  className?: string;
}) {
  switch (status) {
    case "verified":
      return (
        <ShieldCheck
          className={cn("h-3.5 w-3.5 text-emerald-500", className)}
        />
      );
    case "mismatch":
      return (
        <ShieldAlert className={cn("h-3.5 w-3.5 text-amber-500", className)} />
      );
    case "untracked":
      return (
        <ShieldQuestion
          className={cn("h-3.5 w-3.5 text-muted-foreground/50", className)}
        />
      );
    case "no-state":
      return null;
    case "loading":
      return null;
  }
}

function StatusTooltipText({
  refWithStatus,
}: {
  refWithStatus: RefWithStatus;
}) {
  switch (refWithStatus.status) {
    case "verified":
      return (
        <span>
          Signed and verified -- the maintainer's published state matches this
          git server
        </span>
      );
    case "mismatch":
      return (
        <div className="space-y-1">
          <p className="font-medium text-amber-400">Out of sync</p>
          <p>
            The maintainer signed{" "}
            <code className="font-mono text-[11px] bg-amber-500/20 px-1 rounded">
              {refWithStatus.stateCommit?.slice(0, 8)}
            </code>{" "}
            but the git server has{" "}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">
              {refWithStatus.hash.slice(0, 8)}
            </code>
          </p>
          <p className="text-muted-foreground text-[11px]">
            This could mean a push hasn't been signed yet, or the git server was
            updated without the maintainer's knowledge.
          </p>
        </div>
      );
    case "untracked":
      return (
        <span>
          This ref exists on the git server but isn't tracked in the
          maintainer's signed state
        </span>
      );
    case "no-state":
      return null;
    case "loading":
      return <span>Checking verification status...</span>;
  }
}

function RefRow({
  refWithStatus,
  isSelected,
  onSelect,
}: {
  refWithStatus: RefWithStatus;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showTooltip =
    refWithStatus.status !== "no-state" && refWithStatus.status !== "loading";

  const row = (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm rounded-md transition-all duration-150",
        "hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isSelected && "bg-accent",
        refWithStatus.status === "mismatch" &&
          "hover:bg-amber-500/10 dark:hover:bg-amber-500/10",
      )}
    >
      {/* Selection check */}
      <div className="w-4 shrink-0">
        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
      </div>

      {/* Ref name */}
      <span
        className={cn(
          "flex-1 truncate font-mono text-[13px]",
          isSelected && "font-medium",
          refWithStatus.status === "mismatch" &&
            "text-amber-600 dark:text-amber-400",
        )}
        title={refWithStatus.name}
      >
        {refWithStatus.name}
      </span>

      {/* Default badge */}
      {refWithStatus.isDefault && (
        <Badge
          variant="secondary"
          className="text-[10px] h-4 px-1.5 shrink-0 font-normal"
        >
          default
        </Badge>
      )}

      {/* Status icon */}
      <StatusIcon status={refWithStatus.status} className="shrink-0" />
    </button>
  );

  if (showTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-[280px] text-xs"
          sideOffset={8}
        >
          <StatusTooltipText refWithStatus={refWithStatus} />
        </TooltipContent>
      </Tooltip>
    );
  }

  return row;
}

function MismatchBanner({ mismatchCount }: { mismatchCount: number }) {
  return (
    <div className="mx-2 mb-1 mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {mismatchCount === 1
              ? "1 ref is out of sync"
              : `${mismatchCount} refs are out of sync`}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The git server and the maintainer's signed state don't agree on{" "}
            {mismatchCount === 1 ? "a ref" : "some refs"}. This could mean a
            recent push hasn't been signed yet.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoStateBanner() {
  return (
    <div className="mx-2 mb-1 mt-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            No signed state published
          </p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            The maintainer hasn't published a signed snapshot of this repo's
            branches yet. Showing git server data only.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RefSelector({
  refs,
  currentRef,
  onRefChange,
  repoState,
  repoRelayEose,
  loading,
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Compute status for each ref
  const refsWithStatus: RefWithStatus[] = useMemo(
    () =>
      refs.map((ref) => ({
        ...ref,
        ...getRefStatus(ref, repoState, repoRelayEose),
      })),
    [refs, repoState, repoRelayEose],
  );

  // Split into branches and tags
  const branches = useMemo(
    () => refsWithStatus.filter((r) => r.isBranch),
    [refsWithStatus],
  );
  const tags = useMemo(
    () => refsWithStatus.filter((r) => r.isTag),
    [refsWithStatus],
  );

  // Filter by search
  const lowerSearch = search.toLowerCase();
  const filteredBranches = search
    ? branches.filter((b) => b.name.toLowerCase().includes(lowerSearch))
    : branches;
  const filteredTags = search
    ? tags.filter((t) => t.name.toLowerCase().includes(lowerSearch))
    : tags;

  const mismatchCount = countMismatches(refsWithStatus);
  const isNoState = repoRelayEose && repoState === null;

  // Determine if the current ref is a tag
  const currentRefObj = refs.find((r) => r.name === currentRef);
  const currentIsTag = currentRefObj?.isTag ?? false;

  const handleSelect = (refName: string) => {
    onRefChange(refName);
    setOpen(false);
    setSearch("");
  };

  if (loading && refs.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-all duration-200",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "max-w-[280px]",
            mismatchCount > 0
              ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 ref-selector-warning"
              : "border-border/60 bg-background",
          )}
        >
          {currentIsTag ? (
            <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{currentRef}</span>
          {mismatchCount > 0 && (
            <span className="flex items-center gap-1 shrink-0 ml-0.5">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            </span>
          )}
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60 ml-0.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[320px] p-0 overflow-hidden"
        align="start"
        sideOffset={6}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a branch or tag..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            autoFocus
          />
        </div>

        {/* Mismatch banner */}
        {mismatchCount > 0 && <MismatchBanner mismatchCount={mismatchCount} />}

        {/* No state banner */}
        {isNoState && <NoStateBanner />}

        <ScrollArea className="max-h-[360px]">
          <div className="py-1">
            {/* Branches section */}
            {filteredBranches.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <GitBranch className="h-3 w-3" />
                  Branches
                  <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
                    ({filteredBranches.length})
                  </span>
                </div>
                <div className="px-1">
                  {filteredBranches.map((branch) => (
                    <RefRow
                      key={branch.name}
                      refWithStatus={branch}
                      isSelected={branch.name === currentRef}
                      onSelect={() => handleSelect(branch.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Separator between branches and tags */}
            {filteredBranches.length > 0 && filteredTags.length > 0 && (
              <Separator className="my-2" />
            )}

            {/* Tags section */}
            {filteredTags.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <Tag className="h-3 w-3" />
                  Tags
                  <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
                    ({filteredTags.length})
                  </span>
                </div>
                <div className="px-1">
                  {filteredTags.map((tag) => (
                    <RefRow
                      key={tag.name}
                      refWithStatus={tag}
                      isSelected={tag.name === currentRef}
                      onSelect={() => handleSelect(tag.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {filteredBranches.length === 0 && filteredTags.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {search
                    ? `No refs matching "${search}"`
                    : "No branches or tags found"}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer with legend */}
        {repoState !== null && repoState !== undefined && (
          <>
            <Separator />
            <div className="px-3 py-2 flex items-center gap-3 text-[11px] text-muted-foreground/60">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-500/70" />
                signed
              </span>
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-amber-500/70" />
                out of sync
              </span>
              <span className="flex items-center gap-1">
                <ShieldQuestion className="h-3 w-3 text-muted-foreground/40" />
                untracked
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
