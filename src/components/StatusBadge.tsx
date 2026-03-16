import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/nip34";
import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Trash2,
} from "lucide-react";

const statusConfig: Record<
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
      "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 hover:bg-violet-500/20",
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

interface StatusBadgeProps {
  status: IssueStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

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
      {config.label}
    </Badge>
  );
}
