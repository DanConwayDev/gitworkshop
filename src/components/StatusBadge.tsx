import { Badge } from "@/components/ui/badge";
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

export const statusConfig: Record<
  IssueStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  open: {
    label: "Open",
    className:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
    icon: CircleDot,
  },
  resolved: {
    label: "Resolved",
    className:
      "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20 hover:bg-pink-500/20",
    icon: CheckCircle2,
  },
  closed: {
    label: "Closed",
    className:
      "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20",
    icon: XCircle,
  },
  draft: {
    label: "Draft",
    className:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
    icon: FileEdit,
  },
  deleted: {
    label: "Deleted",
    className:
      "bg-muted/50 text-muted-foreground border-muted-foreground/20 hover:bg-muted/70",
    icon: Trash2,
  },
};

/** PR/patch variant overrides for status labels and icons. */
export const prStatusOverrides: Partial<
  Record<IssueStatus, { label: string; icon: React.ElementType }>
> = {
  resolved: {
    label: "Merged",
    icon: GitMerge,
  },
};

interface StatusBadgeProps {
  status: IssueStatus;
  className?: string;
  /**
   * When "pr", uses PR-specific labels (e.g. "Merged" instead of "Resolved").
   * Default: "issue".
   */
  variant?: "issue" | "pr";
}

/** Renders only the icon for a given status, with the status colour applied. */
export function StatusIcon({
  status,
  variant = "issue",
  className,
}: {
  status: IssueStatus;
  variant?: "issue" | "pr";
  className?: string;
}) {
  const config = statusConfig[status];
  const override = variant === "pr" ? prStatusOverrides[status] : undefined;
  const Icon = override?.icon ?? config.icon;
  // Extract the text-colour class from the config so the icon is coloured correctly.
  const colourClass = config.className
    .split(" ")
    .find((c) => c.startsWith("text-"));
  return <Icon className={cn("h-3.5 w-3.5", colourClass, className)} />;
}

export function StatusBadge({
  status,
  className,
  variant = "issue",
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const override = variant === "pr" ? prStatusOverrides[status] : undefined;
  const Icon = override?.icon ?? config.icon;
  const label = override?.label ?? config.label;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium transition-colors",
        config.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
