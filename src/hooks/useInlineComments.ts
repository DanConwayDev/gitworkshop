/**
 * useInlineComments — subscribe to inline code review comments for a PR or patch.
 *
 * Fetches kind:1111 events that have an "E" tag pointing to the root event ID
 * AND an "f" file-path tag (which distinguishes inline comments from regular
 * NIP-22 thread comments).
 *
 * Returns a Map keyed by "<filePath>:<lineNumber>" → NostrEvent[] so the
 * DiffView can look up comments for any given line efficiently.
 *
 * The hook also subscribes to the EventStore so the map updates reactively
 * when new comments arrive.
 */

import { useMemo } from "react";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { pool } from "@/services/nostr";
import { onlyEvents } from "applesauce-relay";
import { mapEventsToStore } from "applesauce-core";
import { map } from "rxjs/operators";
import type { Filter } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import {
  isInlineComment,
  parseInlineCommentLocation,
} from "@/blueprints/inline-comment";

export interface InlineCommentMap {
  /** All inline comment events indexed by file path */
  byFile: Map<string, NostrEvent[]>;
  /**
   * Inline comment events indexed by "<filePath>:<type>:<lineNumber>".
   * type is "add", "del", or "normal" — matching the diff change type so
   * that deleted line 1 and added line 1 don't collide.
   *
   * A comment stored with a plain line number (no side info) is indexed
   * under all three variants so it shows up regardless of change type.
   */
  byLine: Map<string, NostrEvent[]>;
  /** Total count of inline comments */
  total: number;
}

function lineMapKey(
  filePath: string,
  type: "add" | "del" | "normal",
  ln: number,
): string {
  return `${filePath}:${type}:${ln}`;
}

function buildCommentMap(events: NostrEvent[]): InlineCommentMap {
  const byFile = new Map<string, NostrEvent[]>();
  const byLine = new Map<string, NostrEvent[]>();

  const addToLine = (key: string, event: NostrEvent) => {
    const list = byLine.get(key) ?? [];
    list.push(event);
    byLine.set(key, list);
  };

  for (const event of events) {
    const loc = parseInlineCommentLocation(event);
    if (!loc.filePath) continue;

    // Index by file
    const fileList = byFile.get(loc.filePath) ?? [];
    fileList.push(event);
    byFile.set(loc.filePath, fileList);

    // Index by line.
    // "del" side → only appears on deleted lines (old-file number).
    // No side marker → new-file number, appears on add and normal lines.
    if (loc.lineRange) {
      const [start, end] = loc.lineRange;
      for (let ln = start; ln <= end; ln++) {
        if (loc.lineSide === "del") {
          addToLine(lineMapKey(loc.filePath, "del", ln), event);
        } else {
          addToLine(lineMapKey(loc.filePath, "add", ln), event);
          addToLine(lineMapKey(loc.filePath, "normal", ln), event);
        }
      }
    }
  }

  return { byFile, byLine, total: events.length };
}

const EMPTY_MAP: InlineCommentMap = {
  byFile: new Map(),
  byLine: new Map(),
  total: 0,
};

/**
 * Subscribe to inline code review comments for a root PR or patch event.
 *
 * @param rootEventId - The PR (kind:1618) or patch (kind:1617) event ID
 * @param relays      - Relay URLs to query
 */
export function useInlineComments(
  rootEventId: string | undefined,
  relays: string[],
): InlineCommentMap {
  const store = useEventStore();
  const relayKey = relays.join(",");

  // Fetch from relays and add to store
  use$(() => {
    if (!rootEventId || relays.length === 0) return undefined;
    const filter = {
      kinds: [1111],
      "#E": [rootEventId],
    } as Filter;
    return pool
      .subscription(relays, [filter])
      .pipe(onlyEvents(), mapEventsToStore(store));
  }, [rootEventId, relayKey, store]);

  // Subscribe reactively from the store
  const commentMap = use$(() => {
    if (!rootEventId) return undefined;
    const filter = {
      kinds: [1111],
      "#E": [rootEventId],
    } as Filter;
    return store
      .timeline([filter])
      .pipe(
        map((events) =>
          buildCommentMap(events.filter((e) => isInlineComment(e))),
        ),
      );
  }, [rootEventId, store]);

  // Stable memoised key so we don't rebuild the map on every render
  const stableMap = useMemo(() => commentMap ?? EMPTY_MAP, [commentMap]);

  return stableMap;
}

/**
 * Get inline comments for a specific file from the comment map.
 */
export function getFileComments(
  map: InlineCommentMap,
  filePath: string,
): NostrEvent[] {
  return map.byFile.get(filePath) ?? [];
}

/**
 * Get inline comments for a specific line in a file.
 * Line numbers are 1-based (matching git diff output).
 * The changeType distinguishes deleted lines from added lines with the same number.
 */
export function getLineComments(
  map: InlineCommentMap,
  filePath: string,
  lineNumber: number,
  changeType: "add" | "del" | "normal" = "normal",
): NostrEvent[] {
  return map.byLine.get(lineMapKey(filePath, changeType, lineNumber)) ?? [];
}
