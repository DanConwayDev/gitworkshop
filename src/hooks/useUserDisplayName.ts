import { useProfile } from "@/hooks/useProfile";
import { genUserName } from "@/lib/genUserName";

/**
 * Returns the best available display name for a pubkey, plus a flag
 * indicating whether it's a placeholder (no profile loaded yet).
 *
 * Use `isPlaceholder` to apply muted styling so users can distinguish
 * a real chosen name from a generated npub fallback.
 */
export function useUserDisplayName(pubkey: string): {
  name: string;
  isPlaceholder: boolean;
} {
  const profile = useProfile(pubkey);
  const realName =
    profile?.displayName ?? profile?.display_name ?? profile?.name;
  return {
    name: realName ?? genUserName(pubkey),
    isPlaceholder: !realName,
  };
}
