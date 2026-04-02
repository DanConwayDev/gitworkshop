import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/nip34";
import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Trash2,
  GitMerge,
  Check,
} from "lucide-react";

interface StatusTabConfig {
  label: string;
  icon: React.ElementType;
  activeClass: string;
  activeBgClass: string;
  activeCountClass: string;
}

const issueStatusConfig: Record<IssueStatus, StatusTabConfig> = {
  open: {
    label: "Open",
    icon: CircleDot,
    activeClass: "text-emerald-600 dark:text-emerald-400",
    activeBgClass:
      "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600",
    activeCountClass:
      "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400",
  },
  draft: {
    label: "Draft",
    icon: FileEdit,
    activeClass: "text-amber-600 dark:text-amber-400",
    activeBgClass:
      "bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600",
    activeCountClass:
      "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400",
  },
  resolved: {
    label: "Resolved",
    icon: CheckCircle2,
    activeClass: "text-pink-600 dark:text-pink-400",
    activeBgClass:
      "bg-pink-50 dark:bg-pink-950/30 border-pink-400 dark:border-pink-600",
    activeCountClass:
      "bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-400",
  },
  closed: {
    label: "Closed",
    icon: XCircle,
    activeClass: "text-red-600 dark:text-red-400",
    activeBgClass:
      "bg-red-50 dark:bg-red-950/30 border-red-400 dark:border-red-600",
    activeCountClass:
      "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400",
  },
  deleted: {
    label: "Deleted",
    icon: Trash2,
    activeClass: "text-foreground",
    activeBgClass: "bg-accent border-border",
    activeCountClass: "bg-muted text-muted-foreground",
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
 * Multi-select status filter pills. Each pill acts as a toggle checkbox —
 * selected pills get a filled background + checkmark so the multi-select
 * affordance is immediately obvious.
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
      className={cn("flex items-center gap-1.5 flex-wrap", className)}
      role="group"
      aria-label="Filter by status"
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
            role="checkbox"
            aria-checked={isActive}
            onClick={() => toggle(status)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? cn(
                    "font-medium border",
                    config.activeClass,
                    config.activeBgClass,
                  )
                : "text-muted-foreground border-transparent hover:border-border hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {isActive ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{label}</span>
            <span
              className={cn(
                "tabular-nums text-xs rounded-full px-1.5 py-0 leading-5 min-w-[1.25rem] text-center",
                isActive
                  ? config.activeCountClass
                  : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
