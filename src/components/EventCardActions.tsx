import { useState, useCallback } from "react";
import type { NostrEvent } from "nostr-tools";
import {
  getPointerForEvent,
  encodeDecodeResult,
  getSeenRelays,
  isAddressableKind,
  getReplaceableAddress,
} from "applesauce-core/helpers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, Share2, Braces } from "lucide-react";
import { cn } from "@/lib/utils";

/** Build a NIP-19 identifier for an event, including any seen relay hints. */
function eventToNip19(event: NostrEvent): string {
  const relays = Array.from(getSeenRelays(event) ?? []).slice(0, 2);
  const pointer = getPointerForEvent(event, relays);
  return encodeDecodeResult(pointer);
}

// ---------------------------------------------------------------------------
// CopyRow — a labelled row with a truncated value and copy-on-click
// ---------------------------------------------------------------------------

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "group grid w-full grid-cols-[6rem_1fr_1.5rem] items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors",
        "border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        copied ? "border-green-500" : "border-border",
      )}
    >
      <span
        className={cn(
          "font-medium shrink-0",
          copied ? "text-green-600" : "text-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono truncate min-w-0",
          copied ? "text-green-600" : "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// EventCardActions
// ---------------------------------------------------------------------------

interface EventCardActionsProps {
  event: NostrEvent;
  className?: string;
}

export function EventCardActions({ event, className }: EventCardActionsProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  const nip19Id = eventToNip19(event);

  return (
    <>
      <div className={cn("flex items-center gap-0.5", className)}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground"
          title="Share"
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground"
          title="Event JSON"
          onClick={() => setJsonOpen(true)}
        >
          <Braces className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Share modal */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1">
            <CopyRow
              label="gitworkshop.dev"
              value={`https://gitworkshop.dev/${nip19Id}`}
            />
            <CopyRow label="event id" value={`nostr:${nip19Id}`} />
            <CopyRow label="ditto.pub" value={`https://ditto.pub/${nip19Id}`} />
            {isAddressableKind(event.kind) ? (
              <CopyRow
                label="coordinate"
                value={getReplaceableAddress(event) ?? event.id}
              />
            ) : (
              <CopyRow label="hex event id" value={event.id} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Raw JSON modal */}
      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Event JSON</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded-md border bg-muted/40 p-4 min-h-0">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
