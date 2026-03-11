/**
 * Re-export the use$ hook from applesauce-react.
 *
 * This hook subscribes to an RxJS observable and returns the current value.
 * It automatically unsubscribes when the component unmounts.
 *
 * @example
 * ```tsx
 * import { use$ } from '@/hooks/use$';
 * import { eventStore } from '@/services/stores';
 * import { ProfileModel } from 'applesauce-core/models';
 *
 * function UserProfile({ pubkey }: { pubkey: string }) {
 *   const profile = use$(() => eventStore.model(ProfileModel, pubkey), [pubkey]);
 *
 *   return <div>{profile?.name}</div>;
 * }
 * ```
 */
export { use$ } from "applesauce-react/hooks";
