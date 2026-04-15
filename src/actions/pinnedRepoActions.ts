/**
 * Custom Applesauce actions for the NIP-51 pinned git repositories list
 * (kind:10617).
 *
 * Pinned repos are a curated, ordered list of the user's own repositories
 * that they want to highlight on their profile. The order of `a` tags in the
 * event is preserved and used for display ordering.
 *
 * Because kind:10617 is brand-new, we do NOT throw when no existing event is
 * found — we simply build a fresh one.
 */

import { modifyPublicTags } from "applesauce-core/operations";
import {
  addAddressPointerTag,
  removeAddressPointerTag,
} from "applesauce-core/operations/tag/common";
import type { Action } from "applesauce-actions";
import { firstValueFrom, of, timeout } from "rxjs";

/** kind:10617 — pinned git repositories list */
export const PINNED_REPOS_KIND = 10617;

function ModifyPinnedReposEvent(
  operations: ReturnType<typeof addAddressPointerTag>[],
): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(PINNED_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = modifyPublicTags(...operations);

    // Modify existing event or build a fresh one — no throw for missing list
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: PINNED_REPOS_KIND }, operation).then(sign);

    await publish(signed, outboxes);
  };
}

/**
 * Add a repository announcement coordinate to the user's pinned repos list
 * (kind:10617). Appended to the end of the list (lowest priority / newest pin).
 *
 * @param coord - "30617:<pubkey>:<dtag>" coordinate string
 */
export function PinGitRepo(coord: string): Action {
  return ModifyPinnedReposEvent([addAddressPointerTag(coord)]);
}

/**
 * Remove a repository announcement coordinate from the user's pinned repos
 * list (kind:10617).
 *
 * @param coord - "30617:<pubkey>:<dtag>" coordinate string
 */
export function UnpinGitRepo(coord: string): Action {
  return ModifyPinnedReposEvent([removeAddressPointerTag(coord)]);
}

/**
 * Replace the entire ordered list of pinned repo coordinates.
 * Used when the user drags to reorder pinned repos.
 *
 * @param coords - ordered array of "30617:<pubkey>:<dtag>" coordinate strings
 */
export function ReorderPinnedRepos(coords: string[]): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(PINNED_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    // Operation: replace all `a` tags with the new ordered set, preserving
    // any relay hints from the original tags.
    const reorderOperation = modifyPublicTags((tags) => {
      const existingATags = tags.filter(([t]) => t === "a");
      const otherTags = tags.filter(([t]) => t !== "a");
      const newATags = coords.map((coord) => {
        // Preserve any relay hint that was on the original tag
        const original = existingATags.find(([, v]) => v === coord);
        return original ?? ["a", coord];
      });
      return [...otherTags, ...newATags];
    });

    const signed = event
      ? await factory.modify(event, reorderOperation).then(sign)
      : await factory
          .build({ kind: PINNED_REPOS_KIND }, reorderOperation)
          .then(sign);

    await publish(signed, outboxes);
  };
}
