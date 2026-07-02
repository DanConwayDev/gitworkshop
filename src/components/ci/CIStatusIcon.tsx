import { cn } from "@/lib/utils";
import { ciStatusLabel, type CICheckStatus } from "@/lib/ci";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CircleSlash,
  Loader2,
} from "lucide-react";

const iconConfig: Record<
  CICheckStatus,
  { icon: React.ElementType; className: string }
> = {
  success: {
    icon: CheckCircle2,
    className: "text-emerald-500",
  },
  failure: {
    icon: XCircle,
    className: "text-red-500",
  },
  error: {
    icon: AlertTriangle,
    className: "text-red-500",
  },
  skipped: {
    icon: CircleSlash,
    className: "text-muted-foreground",
  },
  pending: {
    icon: Loader2,
    className: "text-amber-500 motion-safe:animate-spin",
  },
};

interface CIStatusIconProps {
  status: CICheckStatus;
  className?: string;
}

/**
 * Compact status icon for a CI check — used in the checks panel and as a
 * small badge in PR list rows.
 */
export function CIStatusIcon({ status, className }: CIStatusIconProps) {
  const config = iconConfig[status];
  const Icon = config.icon;
  return (
    <Icon
      className={cn("h-4 w-4 shrink-0", config.className, className)}
      aria-label={`CI: ${ciStatusLabel(status)}`}
    />
  );
}
