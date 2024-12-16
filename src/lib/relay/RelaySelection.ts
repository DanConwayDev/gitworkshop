import type { ARef, AtLeastThreeArray, PubKeyString } from '$lib/dbs/types'
import { aToAddressPointerAndARef } from '$lib/utils'
import type { AddressPointer } from 'nostr-tools/nip19'
import {
  isWebSocketUrl,
  relays_manager,
  type WebSocketUrl,
} from './RelaysManager'
import db from '$lib/dbs/LocalDb'

export const chooseRelaysForAllRepos = async () => {
  // TODO: expand this to more relays and fetch for different relays each time
  const results = await Promise.all(
    relays_manager.base_relays.map(async (url) => {
      const checks = await db.last_checks.get(`${url}|`)
      if (!checks) return true
      if (checks.timestamp * 1000 < Date.now() - 5000) return true
      return false
    })
  )

  return relays_manager.base_relays.filter((_, index) => results[index])
}

export const chooseRelaysForRepo = async (
  a: AddressPointer | ARef,
  naddr_relays: (string | WebSocketUrl)[] | undefined = undefined
): Promise<WebSocketUrl[]> => {
  const pointer_and_a_ref = aToAddressPointerAndARef(a)
  const urls = new Set<WebSocketUrl>(
    naddr_relays ? naddr_relays.filter((s) => isWebSocketUrl(s)) : []
  )
  // is relay connected?
  // has relay got items in queue?
  if (pointer_and_a_ref) {
    const { a_ref } = pointer_and_a_ref
    const repo_ann = await db.repos.get(a_ref)
    if (repo_ann) {
      repo_ann.seen_on.forEach((value, url) => {
        if (value.up_to_date) urls.add(url)
      })
      repo_ann.relays.forEach((url) => {
        if (isWebSocketUrl(url)) urls.add(url)
      })
      repo_ann.seen_on.forEach((value, url) => {
        if (value.seen) urls.add(url)
      })
    }
  }
  relays_manager.base_relays.forEach((url) => {
    urls.add(url)
  })
  return [...urls].slice(0, 3)
}

export const chooseRelaysForPubkey = async (
  pubkey: PubKeyString
): Promise<AtLeastThreeArray<WebSocketUrl>> => {
  // is relay connected?
  // has relay got items in queue?
  const record = await db.pubkeys.get(pubkey)
  const urls = new Set<WebSocketUrl>()
  if (record) {
    const write = record.relays.write
    const write_relays = write.map((url) => relays_manager.get(url))
    const seen_on_priority = [
      [...record.relays.seen_on]
        .filter(([_, value]) => value.up_to_date)
        .map(([url, _]) => url),
      [...record.relays.seen_on]
        .filter(([_, value]) => value.seen)
        .map(([url, _]) => url),
      [...record.metadata.seen_on]
        .filter(([_, value]) => value.up_to_date)
        .map(([url, _]) => url),
      [...record.metadata.seen_on]
        .filter(([_, value]) => value.seen)
        .map(([url, _]) => url),
    ]
    seen_on_priority.forEach((seen_on: WebSocketUrl[]) => {
      // write, connected, has queue
      write_relays.forEach((relay) => {
        if (seen_on.includes(relay.url)) {
          if (relay.pubkey_metadata_queue.has(relay.url)) {
            if (relay.relay.connected) {
              urls.add(relay.url)
            }
          }
        }
      })
      // write, has queue
      write_relays.forEach((relay) => {
        if (seen_on.includes(relay.url)) {
          if (relay.pubkey_metadata_queue.has(relay.url)) {
            urls.add(relay.url)
          }
        }
      })
      // write
      write_relays.forEach((relay) => {
        if (seen_on.includes(relay.url)) {
          urls.add(relay.url)
        }
      })
    })
    // other write relays
    write_relays.forEach((relay) => urls.add(relay.url))
    // other seen on relays
    ;[...record.relays.seen_on]
      .filter(([_, value]) => value.seen)
      .sort(([__, a], [_, b]) => Number(b.up_to_date) - Number(a.up_to_date))
      .map(([url, _]) => relays_manager.get(url))
      .forEach((relay) => {
        urls.add(relay.url)
      })
    // hint relays
    record.relays.relay_hints_found.forEach((url) => urls.add(url))
  }
  // fallback
  relays_manager.base_relays.forEach((url) => {
    urls.add(url)
  })
  return [...urls] as AtLeastThreeArray<WebSocketUrl>
  // return [...urls].slice(0, 3)
}
