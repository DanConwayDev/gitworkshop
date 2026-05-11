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

import type { Action } from "applesauce-actions";
import type { ProfilePointer } from "applesauce-core/helpers";
import { firstValueFrom, of, timeout } from "rxjs";
import {
  GitAuthorListFactory,
  GIT_AUTHORS_KIND,
} from "@/factories/GitAuthorListFactory";

export { GIT_AUTHORS_KIND };

/** Add a pubkey to the user's NIP-51 Git authors follow list (kind:10017). */
export function AddGitAuthor(user: string | ProfilePointer): Action {
  return async ({ events, user: me, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(GIT_AUTHORS_KIND, me.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      me.outboxes$.$first(1000, undefined),
    ]);

    const factory = event
      ? GitAuthorListFactory.modify(event)
      : GitAuthorListFactory.create();

    const signed = await factory.addUser(user).sign(signer);
    await publish(signed, outboxes);
  };
}

/** Remove a pubkey from the user's NIP-51 Git authors follow list (kind:10017). */
export function RemoveGitAuthor(user: string | ProfilePointer): Action {
  return async ({ events, user: me, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(GIT_AUTHORS_KIND, me.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      me.outboxes$.$first(1000, undefined),
    ]);

    const factory = event
      ? GitAuthorListFactory.modify(event)
      : GitAuthorListFactory.create();

    const signed = await factory.removeUser(user).sign(signer);
    await publish(signed, outboxes);
  };
}
