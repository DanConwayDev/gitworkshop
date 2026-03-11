/**
 * NIP-34 Git Stuff - Constants and helpers
 */

/** Repository announcement (addressable, kind 30617) */
export const REPO_KIND = 30617;

/** Git issue (kind 1621) */
export const ISSUE_KIND = 1621;

/** NIP-22 comment (kind 1111) */
export const COMMENT_KIND = 1111;

/** Status kinds */
export const STATUS_OPEN = 1630;
export const STATUS_RESOLVED = 1631;
export const STATUS_CLOSED = 1632;
export const STATUS_DRAFT = 1633;

export const STATUS_KINDS = [
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
] as const;

export type IssueStatus = "open" | "resolved" | "closed" | "draft";

export function kindToStatus(kind: number): IssueStatus {
  switch (kind) {
    case STATUS_OPEN:
      return "open";
    case STATUS_RESOLVED:
      return "resolved";
    case STATUS_CLOSED:
      return "closed";
    case STATUS_DRAFT:
      return "draft";
    default:
      return "open";
  }
}

/** The single relay we use for NIP-34 */
export const NGIT_RELAY = "wss://relay.ngit.dev";
export const NGIT_RELAYS = [NGIT_RELAY];

/**
 * Build an naddr-style coordinate string for a repo.
 * Format: "30617:<pubkey>:<d-tag>"
 */
export function repoCoordinate(pubkey: string, dTag: string): string {
  return `${REPO_KIND}:${pubkey}:${dTag}`;
}
