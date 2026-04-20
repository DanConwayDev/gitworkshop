import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { labelColor } from "@/lib/labelColor";
import { Tag } from "lucide-react";

interface LabelBadgeProps {
  label: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export function LabelBadge({
  label,
  className,
  onClick,
  active,
}: LabelBadgeProps) {
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
