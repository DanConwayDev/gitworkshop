/**
 * CoverNoteBox — composer for creating / editing a cover note (kind:1624).
 *
 * Shown above the issue/PR body card when the logged-in user is authorised
 * (item author or maintainer). Pre-populated with the latest existing cover
 * note content when one exists.
 *
 * When no cover note exists yet, a subtle "Add cover note" button is shown
 * near the top of the page. Clicking it expands the full composer.
 *
 * When a cover note already exists, an edit icon button is shown next to the
 * history and {} icons inside CoverNoteCard; clicking it calls the onEdit
 * callback which triggers this component to open.
 */

import { useCallback, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { useActiveAccount } from "applesauce-react/hooks";
import { runner } from "@/services/actions";
import { useToast } from "@/hooks/useToast";
import { useProfile } from "@/hooks/useProfile";
import { CreateCoverNote } from "@/actions/nip34";
import { NostrComposer } from "@/components/NostrComposer";
import { composerHasNsec, hasPreviewableContent } from "@/lib/composerUtils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Pin, Loader2, X } from "lucide-react";
import { genUserName } from "@/lib/genUserName";

export interface CoverNoteBoxProps {
  /** The root issue / PR / patch event */
  rootEvent: NostrEvent;
  /** Repo coordinate strings for relay group keying */
  repoCoords?: string[];
  /**
   * Pre-populated content from the latest existing cover note (if any).
   * When provided the composer opens with this content already filled in.
   */
  initialContent?: string;
  /** Called after a cover note is successfully published */
  onSubmitted?: () => void;
  /** Called when the user dismisses the composer without saving */
  onCancel?: () => void;
}

export function CoverNoteBox({
  rootEvent,
  repoCoords,
  initialContent = "",
  onSubmitted,
  onCancel,
}: CoverNoteBoxProps) {
  const [body, setBody] = useState(initialContent);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [focused, setFocused] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  const account = useActiveAccount();
  const profile = useProfile(account?.pubkey);

  const displayName =
    profile?.displayName ??
    profile?.name ??
    (account ? genUserName(account.pubkey) : "");
  const initials = displayName.slice(0, 2).toUpperCase() || "?";

  const showToggle = focused || hasPreviewableContent(body);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = body.trim();
      if (!trimmed) return;

      setIsPending(true);
      try {
        await runner.run(CreateCoverNote, rootEvent, trimmed, repoCoords);

        toast({
          title: "Cover note saved",
          description: "Your cover note has been published.",
        });

        onSubmitted?.();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save cover note";
        toast({
          title: "Failed to save cover note",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsPending(false);
      }
    },
    [body, rootEvent, repoCoords, onSubmitted, toast],
  );

  return (
    <div className="border-l-4 border-blue-500/60 bg-muted/30 rounded-r-md px-4 py-3">
      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
        <Pin className="h-3.5 w-3.5 shrink-0 text-blue-500/70" />
        <span className="font-medium uppercase tracking-wide text-blue-500/80">
          {initialContent ? "Edit cover note" : "Add cover note"}
        </span>
      </div>

      <div className="flex gap-3 items-start">
        {/* Avatar */}
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          {profile?.picture && (
            <AvatarImage src={profile.picture} alt={displayName} />
          )}
          <AvatarFallback className="bg-gradient-to-br from-blue-500/20 to-blue-500/20 text-foreground font-medium text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="flex-1 space-y-2">
          <NostrComposer
            value={body}
            onChange={setBody}
            placeholder="Write a cover note (markdown supported)..."
            disabled={isPending}
            rows={4}
            minRows={4}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onFocusChange={setFocused}
          />

          <div className="flex items-center justify-between gap-2">
            <div
              className={`flex items-center gap-1 transition-opacity duration-200 ${showToggle ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              {(["write", "preview"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={isPending}
                className="gap-1.5 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>

              <Button
                type="submit"
                size="sm"
                disabled={isPending || !body.trim() || composerHasNsec(body)}
                className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save cover note"
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
