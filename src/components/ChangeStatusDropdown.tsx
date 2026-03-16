import { useState, useCallback } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { factory } from "@/services/actions";
import { publish } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import { StatusChangeBlueprint, STATUS_KIND_MAP } from "@/blueprints/status";
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
  /** Optional relay URLs to publish to in addition to git index relays */
  relays?: string[];
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
  relays,
}: ChangeStatusDropdownProps) {
  const account = useActiveAccount();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const handleSelect = useCallback(
    async (next: Exclude<IssueStatus, "deleted">) => {
      if (!account) {
        toast({
          title: "Not logged in",
          description: "You must be logged in to change the status.",
          variant: "destructive",
        });
        return;
      }

      const statusKind = STATUS_KIND_MAP[next];
      setIsPending(true);
      try {
        const template = await factory.create(
          StatusChangeBlueprint,
          statusKind,
          itemId,
          repoCoords,
          itemAuthorPubkey,
          account.pubkey,
        );
        const signed = await factory.sign(template);
        const publishRelays = [...gitIndexRelays.getValue(), ...(relays ?? [])];
        await publish(signed, publishRelays);

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
    [account, itemId, itemAuthorPubkey, repoCoords, relays, toast],
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
