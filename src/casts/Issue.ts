import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { ISSUE_KIND } from "@/lib/nip34";

// Cache symbols
const SubjectSymbol = Symbol.for("issue-subject");
const LabelsSymbol = Symbol.for("issue-labels");
const RepoCoordSymbol = Symbol.for("issue-repo-coord");

/** Validate that a raw event is a well-formed issue */
export function isValidIssue(event: NostrEvent): boolean {
  return event.kind === ISSUE_KIND;
}

export interface IssueData {
  event: NostrEvent;
  id: string;
  pubkey: string;
  subject: string;
  content: string;
  repoCoord: string | undefined;
  labels: string[];
  createdAt: number;
}

export function parseIssue(event: NostrEvent): IssueData | null {
  if (!isValidIssue(event)) return null;

  const subject = getOrComputeCachedValue(
    event,
    SubjectSymbol,
    () => getTagValue(event, "subject") ?? "(untitled)",
  );

  const repoCoord = getOrComputeCachedValue(
    event,
    RepoCoordSymbol,
    () => event.tags.find(([t]) => t === "a")?.[1],
  );

  const labels = getOrComputeCachedValue(event, LabelsSymbol, () =>
    event.tags.filter(([t]) => t === "t").map(([, v]) => v),
  );

  return {
    event,
    id: event.id,
    pubkey: event.pubkey,
    subject,
    content: event.content,
    repoCoord,
    labels,
    createdAt: event.created_at,
  };
}
