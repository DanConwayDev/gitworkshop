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

export function getName(user: User): string {
  return user.profile
    ? user.profile.name
      ? user.profile.name
      : user.profile.displayName
        ? user.profile.displayName
        : truncateNpub(user.npub)
    : truncateNpub(user.npub)
}

function truncateNpub(npub: string): string {
  return `${npub.substring(0, 9)}...`
}
