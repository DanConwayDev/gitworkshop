/**
 * ReplyBox — NIP-22 comment composer for NIP-34 issues and PRs.
 *
 * Uses the CreateComment action (blueprint + outbox relay logic) rather than
 * raw usePublish, so comments are published to the same relay groups as other
 * NIP-34 events (git index + user outbox + repo relays + root author inbox).
 */

import { useCallback, useState } from "react";
import { runner } from "@/services/actions";
import { useToast } from "@/hooks/useToast";
import { CreateComment } from "@/actions/nip34";
import { extractContentTags } from "@/lib/nostrContentTags";
import {
  NostrComposer,
  composerHasNsec,
  hasPreviewableContent,
} from "@/components/NostrComposer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Loader2 } from "lucide-react";

export interface ReplyBoxProps {
  /** Hex event ID of the root issue/PR being commented on */
  rootId: string;
  /** Hex pubkey of the root event author */
  rootPubkey: string;
  /** Kind number of the root event (ISSUE_KIND or PR_KIND) */
  rootKind: number;
  /** Relays declared in the repository announcement */
  repoRelays: string[];
}

export function ReplyBox({
  rootId,
  rootPubkey,
  rootKind,
  repoRelays,
}: ReplyBoxProps) {
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [focused, setFocused] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();

  const showToggle = focused || hasPreviewableContent(body);

  const relayHint = repoRelays[0] ?? "";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = body.trim();
      if (!trimmed) return;

      setIsPending(true);
      try {
        await runner.run(
          CreateComment,
          rootId,
          rootPubkey,
          rootKind,
          trimmed,
          repoRelays,
          relayHint,
          { contentTags: extractContentTags(trimmed) },
        );

        toast({
          title: "Comment posted",
          description: "Your comment has been published.",
        });

        setBody("");
        setActiveTab("write");
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
    [body, rootId, rootPubkey, rootKind, repoRelays, relayHint, toast],
  );

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            <span>Add a comment</span>
          </div>

          <NostrComposer
            value={body}
            onChange={setBody}
            placeholder="Leave a comment."
            disabled={isPending}
            rows={4}
            minRows={4}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onFocusChange={setFocused}
          />

          <div className="flex items-center justify-between">
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
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !body.trim() || composerHasNsec(body)}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Posting...
                </>
              ) : (
                "Comment"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
