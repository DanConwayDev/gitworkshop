import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Tag } from "lucide-react";

/**
 * Deterministic color from a string.
 * Returns a tailwind-compatible hue class.
 */
function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
    "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
    "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
    "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  ];
  return colors[Math.abs(hash) % colors.length];
}

interface LabelBadgeProps {
  label: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export function LabelBadge({ label, className, onClick, active }: LabelBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal transition-all cursor-default",
        labelColor(label),
        active && "ring-2 ring-ring ring-offset-1",
        onClick && "cursor-pointer hover:scale-105",
        className,
      )}
      onClick={onClick}
    >
      <Tag className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}
