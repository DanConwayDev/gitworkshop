import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import { REPO_KIND } from "@/lib/nip34";

// Cache symbols
const NameSymbol = Symbol.for("repo-name");
const DescriptionSymbol = Symbol.for("repo-description");
const DTagSymbol = Symbol.for("repo-d-tag");
const CloneUrlsSymbol = Symbol.for("repo-clone-urls");
const WebUrlsSymbol = Symbol.for("repo-web-urls");
const MaintainersSymbol = Symbol.for("repo-maintainers");
const LabelsSymbol = Symbol.for("repo-labels");
const CoordinateSymbol = Symbol.for("repo-coordinate");

/** Validate that a raw event is a well-formed repository announcement */
export function isValidRepository(event: NostrEvent): boolean {
  return event.kind === REPO_KIND && !!getTagValue(event, "d");
}

/**
 * Lightweight helper object for repository data.
 * We don't extend EventCast here since repos are addressable events
 * and we just need to extract tag data.
 */
export interface RepositoryData {
  event: NostrEvent;
  id: string;
  pubkey: string;
  dTag: string;
  name: string;
  description: string;
  cloneUrls: string[];
  webUrls: string[];
  maintainers: string[];
  labels: string[];
  coordinate: string;
  createdAt: number;
}

export function parseRepository(event: NostrEvent): RepositoryData | null {
  if (!isValidRepository(event)) return null;

  const dTag = getOrComputeCachedValue(
    event,
    DTagSymbol,
    () => getTagValue(event, "d") ?? "",
  );

  const name = getOrComputeCachedValue(
    event,
    NameSymbol,
    () => getTagValue(event, "name") ?? dTag,
  );

  const description = getOrComputeCachedValue(
    event,
    DescriptionSymbol,
    () => getTagValue(event, "description") ?? "",
  );

  const cloneUrls = getOrComputeCachedValue(event, CloneUrlsSymbol, () =>
    event.tags.filter(([t]) => t === "clone").map(([, v]) => v),
  );

  const webUrls = getOrComputeCachedValue(event, WebUrlsSymbol, () =>
    event.tags.filter(([t]) => t === "web").map(([, v]) => v),
  );

  const maintainers = getOrComputeCachedValue(event, MaintainersSymbol, () => {
    const mTag = event.tags.find(([t]) => t === "maintainers");
    return mTag ? mTag.slice(1) : [event.pubkey];
  });

  const labels = getOrComputeCachedValue(event, LabelsSymbol, () =>
    event.tags
      .filter(([t]) => t === "t")
      .map(([, v]) => v)
      .filter((v) => v !== "personal-fork"),
  );

  const coordinate = getOrComputeCachedValue(
    event,
    CoordinateSymbol,
    () => `${REPO_KIND}:${event.pubkey}:${dTag}`,
  );

  return {
    event,
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    name,
    description,
    cloneUrls,
    webUrls,
    maintainers,
    labels,
    coordinate,
    createdAt: event.created_at,
  };
}
