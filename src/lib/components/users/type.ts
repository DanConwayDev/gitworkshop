import type { PubKeyInfo } from '$lib/dbs/types'

export function getName(user: PubKeyInfo, truncate_above = 25): string {
  if (!user) return ''
  return truncate(
    Object.keys(user.metadata.fields).length > 0
      ? user.metadata.fields.name
        ? user.metadata.fields.name
        : user.metadata.fields.displayName
          ? user.metadata.fields.displayName
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
