/**
 * Custom Applesauce actions for the NIP-51 Git repositories follow list (kind:10018).
 *
 * These mirror the AddGitAuthor / RemoveGitAuthor actions (kind:10017) but
 * operate on kind:10018 and use `a` tags (address pointers to kind:30617
 * repository announcements) instead of `p` tags.
 *
 * When following a repository we tag ALL announcement coordinates from the
 * recursive maintainer set so that any client can discover the follow
 * regardless of which maintainer's announcement they encounter first.
 *
 * Because kind:10018 is a brand-new list for most users, we do NOT throw when
 * no existing event is found — we simply build a fresh one.
 */

import { modifyPublicTags } from "applesauce-core/operations";
import {
  addAddressPointerTag,
  removeAddressPointerTag,
} from "applesauce-core/operations/tag/common";
import type { Action } from "applesauce-actions";
import { firstValueFrom, of, timeout } from "rxjs";

/** kind:10018 — NIP-51 Git repositories follow list */
export const GIT_REPOS_KIND = 10018;

function ModifyGitReposEvent(
  operations: ReturnType<typeof addAddressPointerTag>[],
): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(GIT_REPOS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = modifyPublicTags(...operations);

    // Modify existing event or build a fresh one — no throw for missing list
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: GIT_REPOS_KIND }, operation).then(sign);

    await publish(signed, outboxes);
  };
}

/**
 * Add one or more repository announcement coordinates to the user's NIP-51
 * Git repositories follow list (kind:10018).
 *
 * Pass all coordinates from the recursive maintainer set so the follow is
 * discoverable via any maintainer's announcement.
 *
 * @param coords - One or more "30617:<pubkey>:<dtag>" coordinate strings
 */
export function AddGitRepo(...coords: string[]): Action {
  return ModifyGitReposEvent(coords.map((c) => addAddressPointerTag(c)));
}

/**
 * Remove one or more repository announcement coordinates from the user's
 * NIP-51 Git repositories follow list (kind:10018).
 *
 * @param coords - One or more "30617:<pubkey>:<dtag>" coordinate strings
 */
export function RemoveGitRepo(...coords: string[]): Action {
  return ModifyGitReposEvent(coords.map((c) => removeAddressPointerTag(c)));
}
