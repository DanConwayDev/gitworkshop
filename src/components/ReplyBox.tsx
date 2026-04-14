/**
 * ReplyBox — NIP-22 comment composer for NIP-34 issues and PRs.
 *
 * Uses the CreateComment action (blueprint + outbox relay logic) rather than
 * raw usePublish, so comments are published to the same relay groups as other
 * NIP-34 events (git index + user outbox + repo relays + root author inbox).
 *
 * When no account is logged in, an "Anonymous" checkbox appears. Checking it
 * signs the comment with a fresh ephemeral key so the user can post without
 * creating a Nostr identity first.
 */

import { useCallback, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { useActiveAccount } from "applesauce-react/hooks";
import { runner } from "@/services/actions";
import { createAnonRunner } from "@/lib/anonPublish";
import { useToast } from "@/hooks/useToast";
import { useProfile } from "@/hooks/useProfile";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { CreateComment } from "@/actions/nip34";
import { NostrComposer } from "@/components/NostrComposer";
import { composerHasNsec, hasPreviewableContent } from "@/lib/composerUtils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { Loader2 } from "lucide-react";

export interface ReplyBoxProps {
  /** The root issue/PR event being commented on */
  rootEvent: NostrEvent;
  /**
   * When replying to an existing comment rather than the root, provide the
   * parent comment event. The applesauce CommentBlueprint will automatically
   * propagate the root E/K/P tags from the parent comment.
   */
  parentEvent?: NostrEvent;
  /** Called after a comment is successfully posted (e.g. to close an inline composer) */
  onSubmitted?: () => void;
  /**
   * Ordered pubkeys to surface first in @ mention autocomplete:
   * parent author → thread participants → repo maintainers.
   */
  priorityPubkeys?: string[];
}

export function ReplyBox({
  rootEvent,
  parentEvent,
  onSubmitted,
  priorityPubkeys,
}: ReplyBoxProps) {
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [focused, setFocused] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [anonMode, setAnonMode] = useState(false);
  const { toast } = useToast();
  const { openAuthModal } = useAuthModal();

  const account = useActiveAccount();
  const profile = useProfile(account?.pubkey);
  const { name: displayName } = useUserDisplayName(account?.pubkey ?? "");

  const isLoggedIn = !!account;

  const initials = displayName.slice(0, 2).toUpperCase() || "?";

  const showToggle = focused || hasPreviewableContent(body);

  // The applesauce CommentBlueprint takes the immediate parent event.
  // For a top-level comment that's the root; for a reply it's the comment.
  const parent = parentEvent ?? rootEvent;

  const submitComment = useCallback(
    async (trimmed: string, useAnonMode: boolean) => {
      const activeRunner =
        !isLoggedIn && useAnonMode ? createAnonRunner() : runner;

      setIsPending(true);
      try {
        await activeRunner.run(CreateComment, parent, trimmed, rootEvent);

        toast({
          title: "Comment posted",
          description: "Your comment has been published.",
        });

        setBody("");
        setActiveTab("write");
        onSubmitted?.();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        toast({
          title: "Failed to post comment",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsPending(false);
      }
    },
    [parent, rootEvent, onSubmitted, toast, isLoggedIn],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = body.trim();
      if (!trimmed) return;

      // Not logged in and not anonymous — open auth modal and retry on success
      if (!isLoggedIn && !anonMode) {
        openAuthModal("landing", () => submitComment(trimmed, false));
        return;
      }

      await submitComment(trimmed, anonMode);
    },
    [body, isLoggedIn, anonMode, openAuthModal, submitComment],
  );

  return (
    <div className="flex gap-3 items-start">
      {/* Avatar — shows who is posting */}
      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
        {profile?.picture && (
          <AvatarImage src={profile.picture} alt={displayName} />
        )}
        <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-pink-500/20 text-foreground font-medium text-xs">
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="flex-1 space-y-2">
        <NostrComposer
          value={body}
          onChange={setBody}
          placeholder="Leave a comment..."
          disabled={isPending}
          rows={4}
          minRows={4}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onFocusChange={setFocused}
          priorityPubkeys={priorityPubkeys}
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

          <div className="flex items-center gap-3 ml-auto">
            {/* Anonymous checkbox — only shown when not logged in */}
            {!isLoggedIn && (
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="reply-anon"
                  checked={anonMode}
                  onCheckedChange={(checked) => setAnonMode(checked === true)}
                  disabled={isPending}
                  className="h-3.5 w-3.5"
                />
                <Label
                  htmlFor="reply-anon"
                  className="text-xs text-muted-foreground cursor-pointer select-none"
                >
                  Anonymous
                </Label>
              </div>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={isPending || !body.trim() || composerHasNsec(body)}
              className="gap-1.5 bg-pink-600 hover:bg-pink-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Signing...
                </>
              ) : (
                "Comment"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
