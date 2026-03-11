import { useCallback, useState } from "react";
import { useActiveAccount } from "applesauce-react/hooks";
import { publish } from "@/services/nostr";
import type { NostrEvent, EventTemplate } from "nostr-tools";

/**
 * Hook for publishing events.
 * Automatically adds client tag and handles signing.
 *
 * @example
 * ```tsx
 * import { usePublish } from '@/hooks/usePublish';
 *
 * function PostForm() {
 *   const { publishEvent, isPending } = usePublish();
 *
 *   const handleSubmit = async () => {
 *     await publishEvent({ kind: 1, content: 'Hello Nostr!', tags: [] });
 *   };
 *
 *   return <button onClick={handleSubmit} disabled={isPending}>Post</button>;
 * }
 * ```
 */
export function usePublish() {
  const activeAccount = useActiveAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const publishEvent = useCallback(
    async (template: EventTemplate): Promise<NostrEvent> => {
      if (!activeAccount) {
        throw new Error("User is not logged in");
      }

      setIsPending(true);
      setError(null);

      try {
        // Add client tag if on HTTPS
        const tags = [...(template.tags || [])];
        if (
          location.protocol === "https:" &&
          !tags.some(([name]) => name === "client")
        ) {
          tags.push(["client", location.hostname]);
        }

        // Create the event template with client tag
        const eventTemplate: EventTemplate = {
          ...template,
          tags,
          created_at: template.created_at ?? Math.floor(Date.now() / 1000),
        };

        // Sign the event using the signer
        const signedEvent = await activeAccount.signer.signEvent(eventTemplate);

        // Publish to relays
        await publish(signedEvent);

        console.log("Event published successfully:", signedEvent);
        return signedEvent;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to publish event");
        setError(error);
        console.error("Failed to publish event:", error);
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [activeAccount],
  );

  return {
    publishEvent,
    mutateAsync: publishEvent, // Compatibility with old API
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Alias for usePublish for backward compatibility.
 * @deprecated Use usePublish instead
 */
export function useNostrPublish() {
  return usePublish();
}
