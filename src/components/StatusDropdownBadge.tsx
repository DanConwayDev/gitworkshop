import { useState, useCallback } from "react";
import { runner } from "@/services/actions";
import { ChangeIssueStatus } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { badgeVariants } from "@/components/ui/badge-variants";
import { Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/nip34";
import { StatusBadge } from "@/components/StatusBadge";
import { statusConfig, prStatusOverrides } from "@/lib/statusConfig";

export interface StatusOption {
  value: Exclude<IssueStatus, "deleted">;
  label: string;
}

interface StatusDropdownBadgeProps {
  status: IssueStatus;
  className?: string;
  /**
   * When "pr", uses PR-specific labels (e.g. "Merged" instead of "Resolved").
   * Default: "issue".
   */
  variant?: "issue" | "pr";
  /** Whether the current user has permission to change the status. */
  canEdit: boolean;
  /** The event ID of the issue or PR being updated. Required when canEdit=true. */
  itemId?: string;
  /** Pubkey of the issue/PR author (for p-tag notifications). Required when canEdit=true. */
  itemAuthorPubkey?: string;
  /**
   * All repository coordinates from the item's `a` tags.
   * Required when canEdit=true.
   */
  repoCoords?: string[];
  /** Available status options to show in the dropdown. Required when canEdit=true. */
  options?: StatusOption[];
}

/**
 * Displays the current status as a badge. When the user has permission to
 * edit (`canEdit=true`) the badge becomes a dropdown trigger for changing the
 * status in-place, replacing the need for a separate "Change status" button.
 */
export function StatusDropdownBadge({
  status,
  className,
  variant = "issue",
  canEdit,
  itemId,
  itemAuthorPubkey,
  repoCoords,
  options,
}: StatusDropdownBadgeProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const handleSelect = useCallback(
    async (next: Exclude<IssueStatus, "deleted">) => {
      if (!itemId || !itemAuthorPubkey || !repoCoords) return;
      setIsPending(true);
      try {
        await runner.run(
          ChangeIssueStatus,
          itemId,
          itemAuthorPubkey,
          repoCoords,
          next,
        );
        toast({
          title: "Status updated",
          description: `Status changed to "${next}".`,
        });
      } catch (err) {
        toast({
          title: "Failed to update status",
          description:
            err instanceof Error ? err.message : "Failed to update status",
          variant: "destructive",
        });
      } finally {
        setIsPending(false);
      }
    },
    [itemId, itemAuthorPubkey, repoCoords, toast],
  );

  const config = statusConfig[status];
  const override = variant === "pr" ? prStatusOverrides[status] : undefined;
  const Icon = override?.icon ?? config.icon;
  const label = override?.label ?? config.label;

  // If not editable, deleted, or missing required props, render a plain badge.
  const availableOptions = options?.filter((o) => o.value !== status) ?? [];
  if (!canEdit || status === "deleted" || availableOptions.length === 0) {
    return (
      <StatusBadge status={status} variant={variant} className={className} />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isPending}>
        <button
          className={cn(
            badgeVariants({ variant: "outline" }),
            "gap-1 font-medium cursor-pointer",
            config.className,
            isPending && "opacity-70",
            className,
          )}
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
          {label}
          <ChevronDown className="h-2.5 w-2.5 opacity-50 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {availableOptions.map((opt) => {
          const optConfig = statusConfig[opt.value];
          const optOverride =
            variant === "pr" ? prStatusOverrides[opt.value] : undefined;
          const OptIcon = optOverride?.icon ?? optConfig.icon;
          const optColour = optConfig.className
            .split(" ")
            .find((c) => c.startsWith("text-"));
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => handleSelect(opt.value)}
              className="gap-2"
            >
              <OptIcon className={cn("h-3.5 w-3.5", optColour)} />
              {opt.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
