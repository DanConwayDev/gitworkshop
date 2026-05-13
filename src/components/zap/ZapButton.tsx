/**
 * ZapButton — small Lightning button placed near the zap-total stat on the
 * PR and Issue sidebar cards. Opens the ZapModal when clicked.
 *
 * Three disabled states (shown as a disabled button + tooltip):
 *   - No signed-in account → "Sign in to zap".
 *   - Recipient profile loaded but has no lud16/lud06 → "No lightning address".
 *   - Recipient is the current user → "You can't zap yourself".
 */
import { useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { useActiveAccount } from "applesauce-react/hooks";
import { Zap } from "lucide-react";

import { use$ } from "@/hooks/use$";
import { useUser } from "@/hooks/useUser";
import { getRecipientLnurl } from "@/lib/zap";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ZapModal } from "@/components/zap/ZapModal";

interface ZapButtonProps {
  event: NostrEvent;
  className?: string;
}

export function ZapButton({ event, className }: ZapButtonProps) {
  const account = useActiveAccount();
  const recipient = useUser(event.pubkey);
  const profile = use$(() => recipient?.profile$, [recipient]);
  const [open, setOpen] = useState(false);

  const lnurl = getRecipientLnurl(profile);
  const isSelf = account?.pubkey === event.pubkey;

  let disabledReason: string | null = null;
  if (!account) disabledReason = "Sign in to zap";
  else if (isSelf) disabledReason = "You can't zap yourself";
  else if (!lnurl) disabledReason = "Recipient has no lightning address";

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!!disabledReason}
      onClick={() => setOpen(true)}
      className={cn(
        "gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-500 dark:hover:bg-amber-950/40 border-amber-200 dark:border-amber-900/40",
        className,
      )}
    >
      <Zap className="h-4 w-4" />
      Zap
    </Button>
  );

  return (
    <>
      {disabledReason ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}

      {!disabledReason && lnurl && (
        <ZapModal
          open={open}
          onOpenChange={setOpen}
          event={event}
          lnurl={lnurl}
        />
      )}
    </>
  );
}
