import { useActiveAccount } from "applesauce-react/hooks";

/**
 * Get the currently logged-in account.
 *
 * Returns account information including pubkey and signer,
 * or null if no account is logged in.
 *
 * @deprecated Use `useActiveAccount` from `applesauce-react/hooks` directly instead.
 * This hook is kept for backward compatibility but will be removed in a future version.
 *
 * @example
 * ```tsx
 * import { useActiveAccount } from 'applesauce-react/hooks';
 *
 * function MyComponent() {
 *   const account = useActiveAccount();
 *
 *   if (!account) {
 *     return <LoginPrompt />;
 *   }
 *
 *   return <div>Logged in as {account.pubkey}</div>;
 * }
 * ```
 */
export function useAccount() {
  const account = useActiveAccount();

  if (!account) {
    return null;
  }

  return {
    pubkey: account.pubkey,
    signer: account.signer,
  };
}

/**
 * Check if a user is currently logged in.
 *
 * @example
 * ```tsx
 * import { useIsLoggedIn } from '@/hooks/useAccount';
 *
 * function CreatePostButton() {
 *   const isLoggedIn = useIsLoggedIn();
 *
 *   if (!isLoggedIn) {
 *     return <LoginButton />;
 *   }
 *
 *   return <Button>Create Post</Button>;
 * }
 * ```
 */
export function useIsLoggedIn() {
  const account = useActiveAccount();
  return account !== undefined;
}
