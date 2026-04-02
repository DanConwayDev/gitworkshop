import { useState, useCallback } from "react";
import { runner } from "@/services/actions";
import { ChangeIssueStatus } from "@/actions/nip34";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, ChevronDown } from "lucide-react";
import type { IssueStatus } from "@/lib/nip34";

export interface StatusOption {
  value: Exclude<IssueStatus, "deleted">;
  label: string;
}

interface ChangeStatusDropdownProps {
  /** The event ID of the issue or PR being updated */
  itemId: string;
  /** Pubkey of the issue/PR author (for p-tag notifications) */
  itemAuthorPubkey: string;
  /** All repository coordinates from the item's `a` tags ("30617:<owner-pubkey>:<repo-id>").
   *  One `a` tag and one `p` tag (for the owner) will be emitted per coordinate. */
  repoCoords: string[];
  /** The current status (used to exclude it from the options) */
  currentStatus: IssueStatus;
  /** Available status options to show */
  options: StatusOption[];
}

/**
 * Dropdown button that lets an authorised user change the status of an issue
 * or PR by publishing a NIP-34 status event (kind 1630–1633).
 */
export function ChangeStatusDropdown({
  itemId,
  itemAuthorPubkey,
  repoCoords,
  currentStatus,
  options,
}: ChangeStatusDropdownProps) {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const handleSelect = useCallback(
    async (next: Exclude<IssueStatus, "deleted">) => {
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
        const message =
          err instanceof Error ? err.message : "Failed to update status";
        toast({
          title: "Failed to update status",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsPending(false);
      }
    },
    [itemId, itemAuthorPubkey, repoCoords, toast],
  );

  // Only show options that differ from the current status.
  const availableOptions = options.filter((o) => o.value !== currentStatus);

  if (availableOptions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs w-full"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
          )}
          Change status
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {availableOptions.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => handleSelect(opt.value)}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
