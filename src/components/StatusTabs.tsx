import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/nip34";
import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Trash2,
  GitMerge,
} from "lucide-react";

interface StatusTabConfig {
  label: string;
  icon: React.ElementType;
  activeClass: string;
}

const issueStatusConfig: Record<IssueStatus, StatusTabConfig> = {
  open: {
    label: "Open",
    icon: CircleDot,
    activeClass: "text-emerald-600 dark:text-emerald-400",
  },
  draft: {
    label: "Draft",
    icon: FileEdit,
    activeClass: "text-amber-600 dark:text-amber-400",
  },
  resolved: {
    label: "Resolved",
    icon: CheckCircle2,
    activeClass: "text-violet-600 dark:text-violet-400",
  },
  closed: {
    label: "Closed",
    icon: XCircle,
    activeClass: "text-red-600 dark:text-red-400",
  },
  deleted: {
    label: "Deleted",
    icon: Trash2,
    activeClass: "text-muted-foreground",
  },
};

const prStatusOverrides: Partial<
  Record<IssueStatus, { label: string; icon: React.ElementType }>
> = {
  resolved: {
    label: "Merged",
    icon: GitMerge,
  },
};

interface StatusTabsProps {
  /** Count of items per status (statuses with 0 count are still shown) */
  counts: Record<IssueStatus, number>;
  /** Currently selected statuses */
  selected: IssueStatus[];
  /** Called when selection changes */
  onChange: (selected: IssueStatus[]) => void;
  /** Use PR labels (e.g. "Merged" instead of "Resolved") */
  variant?: "issue" | "pr";
  className?: string;
}

/**
 * GitHub-style status tabs showing count per status.
 * Clicking a tab toggles that status in the selection.
 * Selected tabs are visually highlighted with color and bold text.
 */
export function StatusTabs({
  counts,
  selected,
  onChange,
  variant = "issue",
  className,
}: StatusTabsProps) {
  const toggle = (status: IssueStatus) => {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status));
    } else {
      onChange([...selected, status]);
    }
  };

  // Only show statuses that have items OR are currently selected
  const visibleStatuses = (
    Object.keys(issueStatusConfig) as IssueStatus[]
  ).filter((status) => counts[status] > 0 || selected.includes(status));

  return (
    <div
      className={cn(
        "flex items-center gap-1 flex-wrap border-b border-border pb-2",
        className,
      )}
      role="tablist"
    >
      {visibleStatuses.map((status) => {
        const config = issueStatusConfig[status];
        const override =
          variant === "pr" ? prStatusOverrides[status] : undefined;
        const Icon = override?.icon ?? config.icon;
        const label = override?.label ?? config.label;
        const isActive = selected.includes(status);
        const count = counts[status];

        return (
          <button
            key={status}
            role="tab"
            aria-selected={isActive}
            onClick={() => toggle(status)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? cn("font-semibold", config.activeClass)
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="tabular-nums">{count}</span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
