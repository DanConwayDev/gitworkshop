import type { AddressPointer } from 'nostr-tools/lib/types/nip19'
import type { RepoCollection, RepoEvent } from './type'
import { nip19 } from 'nostr-tools'
import { repo_kind } from '$lib/kinds'
import type { NDKEvent, NDKRelay } from '@nostr-dev-kit/ndk'

export const selectRepoFromCollection = (
  collection: RepoCollection
): RepoEvent | undefined => {
  return collection.events[collection.most_recent_index]
}

/** most servers will produce a CORS error so a proxy should be used */
export const cloneArrayToReadMeUrls = (clone: string[]): string[] => {
  const addresses = clone.map(extractRepoAddress)
  /**
   * at the time of this commit these urls work for:
   * self-hosted gitea (or forgejo), gitlab
   * github.com
   * bitbucket.org
   * gitlab.org
   * gitea.com
   * codeberg.org (forgejo instance)
   * sourcehut (git.sr.ht)
   * launchpad.net
   * It doesnt work for:
   * self-hosted gogs (requires branch name repo/raw/master/README.md)
   * sourceforge.net (https://sourceforge.net/p/mingw/catgets/ci/master/tree/README?format=raw)
   * notabug.org (requires branch name notabug.org/org/repo/raw/master/README.md)
   */
  return [
    ...addresses.flatMap((address) => {
      let prefix = 'raw/HEAD'
      if (address.includes('sr.ht')) prefix = 'blob/HEAD'
      if (
        address.includes('git.launchpad.net') ||
        address.includes('git.savannah.gnu.org')
      )
        prefix = 'plain'
      if (address.includes('github.com')) {
        // raw.githubusercontent.com can be used without CORS error
        address = address.replace('github.com', 'raw.githubusercontent.com')
        prefix = 'HEAD'
      }
      return ['README.md', 'readme.md'].map(
        (filename) => `https://${address}/${prefix}/${filename}`
      )
    }),
  ]
}

const extractRepoAddress = (clone_string: string): string => {
  let s = clone_string
  // remove trailing slash
  if (s.endsWith('/')) s = s.substring(0, s.length - 1)
  // remove trailing .git
  if (s.endsWith('.git')) s = s.substring(0, s.length - 4)
  // remove :// and anything before
  if (s.includes('://')) s = s.split('://')[1]
  // remove @ and anything before
  if (s.includes('@')) s = s.split('@')[1]
  // replace : with /
  s = s.replace(/\s|:[0-9]+/g, '')
  s = s.replace(':', '/')
  return s
}

export const naddrToPointer = (s: string): AddressPointer | undefined => {
  const decoded = nip19.decode(s)
  if (
    typeof decoded.data === 'string' ||
    !Object.keys(decoded.data).includes('identifier')
  )
    return undefined
  return decoded.data as AddressPointer
}

export const extractAReference = (a: string): AddressPointer | undefined => {
  if (a.split(':').length !== 3) return undefined
  const [k, pubkey, identifier] = a.split(':')
  return { kind: Number(k), pubkey, identifier }
}

export const naddrToRepoA = (s: string): string | undefined => {
  const pointer = naddrToPointer(s)
  if (pointer && pointer.kind === repo_kind)
    return `${repo_kind}:${pointer.pubkey}:${pointer.identifier}`
  return undefined
}

export const aToNaddr = (
  a: string | AddressPointer
): `naddr1${string}` | undefined => {
  const a_ref = typeof a === 'string' ? extractAReference(a) : a
  if (!a_ref) return undefined
  return nip19.naddrEncode(a_ref)
}

export const neventOrNoteToHexId = (s: string): string | undefined => {
  try {
    const decoded = nip19.decode(s)
    if (decoded.type === 'note') return decoded.data
    else if (decoded.type === 'nevent') return decoded.data.id
  } catch {}
  return undefined
}

/** this functoin can be removed when ndk.encode includes kind in nevent */
export const ndkEventToNeventOrNaddr = (
  event: NDKEvent
): string | undefined => {
  let relays: string[] = []
  if (event.onRelays.length > 0) {
    relays = event.onRelays.map((relay) => relay.url)
  } else if (event.relay) {
    relays = [event.relay.url]
  }
  if (event.kind && event.isParamReplaceable()) {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: event.replaceableDTag(),
      relays,
    })
  } else if (relays.length > 0) {
    return nip19.neventEncode({
      kind: event.kind,
      id: event.tagId(),
      relays,
      author: event.pubkey,
    })
  } else {
    return nip19.noteEncode(event.tagId())
  }
}
