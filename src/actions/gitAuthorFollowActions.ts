/**
 * Custom Applesauce actions for the NIP-51 Git authors follow list (kind:10017).
 *
 * These mirror the built-in FollowUser / UnfollowUser actions (kind:3) but
 * operate on kind:10017 instead. The pattern is identical: fetch the latest
 * replaceable event, modify its public `p` tags, sign, and publish to the
 * user's outboxes.
 *
 * Because kind:10017 is a brand-new list for most users, we do NOT throw when
 * no existing event is found — we simply build a fresh one.
 */

import { modifyPublicTags } from "applesauce-core/operations";
import {
  addProfilePointerTag,
  removeProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import type { Action } from "applesauce-actions";
import type { ProfilePointer } from "applesauce-core/helpers";
import { firstValueFrom, of, timeout } from "rxjs";

/** kind:10017 — NIP-51 Git authors follow list */
export const GIT_AUTHORS_KIND = 10017;

function ModifyGitAuthorsEvent(
  operations: ReturnType<typeof addProfilePointerTag>[],
): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(GIT_AUTHORS_KIND, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = modifyPublicTags(...operations);

    // Modify existing event or build a fresh one — no throw for missing list
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: GIT_AUTHORS_KIND }, operation).then(sign);

    await publish(signed, outboxes);
  };
}

/** Add a pubkey to the user's NIP-51 Git authors follow list (kind:10017). */
export function AddGitAuthor(user: string | ProfilePointer): Action {
  return ModifyGitAuthorsEvent([addProfilePointerTag(user)]);
}

/** Remove a pubkey from the user's NIP-51 Git authors follow list (kind:10017). */
export function RemoveGitAuthor(user: string | ProfilePointer): Action {
  return ModifyGitAuthorsEvent([removeProfilePointerTag(user)]);
}
