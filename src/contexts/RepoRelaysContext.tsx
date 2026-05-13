/**
 * RepoRelaysContext — provides the current repo's relay URLs to any component
 * inside RepoLayout.
 *
 * Set by RepoLayoutResolved from relayGroupUrls$(repoRelayGroup) so it stays
 * reactive as outbox relays are resolved. Consumed by ZapModal to ensure zap
 * receipts are published to the repo relays — i.e. where nip34RepoLoader is
 * already subscribed — regardless of which event is being zapped (repo
 * announcements, issues, PRs, comments, etc.).
 */
import { createContext, useContext } from "react";

export const RepoRelaysContext = createContext<string[]>([]);

/** Returns the current repo's relay URLs, or an empty array outside RepoLayout. */
export function useRepoRelays(): string[] {
  return useContext(RepoRelaysContext);
}
