import type { NDKUserProfile } from '@nostr-dev-kit/ndk'

export interface User {
  loading: boolean
  hexpubkey: string
  npub: string
  profile?: NDKUserProfile
}

export const defaults: User = {
  loading: true,
  hexpubkey: '',
  npub: '',
}

export function getName(user: User, truncate_above = 25): string {
  return truncate(
    user.profile
      ? user.profile.name
        ? user.profile.name
        : user.profile.displayName
          ? user.profile.displayName
          : truncateNpub(user.npub)
      : truncateNpub(user.npub),
    truncate_above
  )
}

function truncateNpub(npub: string): string {
  return `${npub.substring(0, 9)}...`
}

function truncate(s: string, truncate_above = 20): string {
  if (s.length < truncate_above || truncate_above < 5) return s
  return `${s.substring(0, truncate_above - 3)}...`
}
