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

import type { Action } from "applesauce-actions";
import { firstValueFrom, of, timeout } from "rxjs";
import {
  PinnedReposFactory,
  PINNED_REPOS_KIND,
} from "@/factories/PinnedReposFactory";

export { PINNED_REPOS_KIND };

/**
 * Add a repository announcement coordinate to the user's pinned repos list
 * (kind:10617). Appended to the end of the list (lowest priority / newest pin).
 *
 * @param coord - "30617:<pubkey>:<dtag>" coordinate string
 */
export function PinGitRepo(coord: string): Action {
  return async ({ events, user, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(PINNED_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const factory = event
      ? PinnedReposFactory.modify(event)
      : PinnedReposFactory.create();

    const signed = await factory.addAddressItem(coord).sign(signer);
    await publish(signed, outboxes);
  };
}

/**
 * Remove a repository announcement coordinate from the user's pinned repos
 * list (kind:10617).
 *
 * @param coord - "30617:<pubkey>:<dtag>" coordinate string
 */
export function UnpinGitRepo(coord: string): Action {
  return async ({ events, user, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(PINNED_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const factory = event
      ? PinnedReposFactory.modify(event)
      : PinnedReposFactory.create();

    const signed = await factory.removeAddressItem(coord).sign(signer);
    await publish(signed, outboxes);
  };
}

/**
 * Replace the entire ordered list of pinned repo coordinates.
 * Used when the user drags to reorder pinned repos.
 *
 * @param coords - ordered array of "30617:<pubkey>:<dtag>" coordinate strings
 */
export function ReorderPinnedRepos(coords: string[]): Action {
  return async ({ events, user, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(PINNED_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const factory = event
      ? PinnedReposFactory.modify(event)
      : PinnedReposFactory.create();

    const signed = await factory.reorder(coords).sign(signer);
    await publish(signed, outboxes);
  };
}
