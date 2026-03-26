import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/nip34";
import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Trash2,
  GitMerge,
  GitPullRequest,
  GitCommitHorizontal,
} from "lucide-react";

const issueIconConfig: Record<
  IssueStatus,
  { icon: React.ElementType; className: string; title: string }
> = {
  open: {
    icon: CircleDot,
    className: "text-emerald-500",
    title: "Open",
  },
  draft: {
    icon: FileEdit,
    className: "text-muted-foreground",
    title: "Draft",
  },
  resolved: {
    icon: CheckCircle2,
    className: "text-violet-500",
    title: "Resolved",
  },
  closed: {
    icon: XCircle,
    className: "text-muted-foreground",
    title: "Closed",
  },
  deleted: {
    icon: Trash2,
    className: "text-muted-foreground",
    title: "Deleted",
  },
};

const prIconOverrides: Partial<
  Record<IssueStatus, { icon: React.ElementType; title: string }>
> = {
  open: {
    icon: GitPullRequest,
    title: "Open",
  },
  resolved: {
    icon: GitMerge,
    title: "Merged",
  },
};

interface StatusIconProps {
  status: IssueStatus;
  className?: string;
  /**
   * When "pr", uses PR-specific icons (GitPullRequest / GitMerge).
   * When "patch", uses GitCommitHorizontal for open.
   * Default: "issue".
   */
  variant?: "issue" | "pr" | "patch";
}

/**
 * Compact status icon for use in condensed list rows.
 * Shows just the icon with a status-appropriate color — no text label.
 */
export function StatusIcon({
  status,
  className,
  variant = "issue",
}: StatusIconProps) {
  const config = issueIconConfig[status];
  let Icon = config.icon;
  let title = config.title;

  if (variant === "pr") {
    const override = prIconOverrides[status];
    if (override) {
      Icon = override.icon;
      title = override.title;
    }
  } else if (variant === "patch" && status === "open") {
    Icon = GitCommitHorizontal;
    title = "Open (Patch)";
  }

  return (
    <Icon
      className={cn("h-5 w-5 shrink-0", config.className, className)}
      aria-label={title}
    />
  );
}
