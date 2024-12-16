import { RelayManager } from './RelayManager'
import type { ARef, PubKeyString } from '$lib/dbs/types'
import { safeRelayUrl } from 'applesauce-core/helpers'
import {
  chooseRelaysForAllRepos,
  chooseRelaysForPubkey,
  chooseRelaysForRepo,
} from './RelaySelection'
import { aRefToAddressPointer } from '$lib/components/repo/utils'
import db from '$lib/dbs/LocalDb'
import { identifierRepoAnnsToRepoCollection } from '$lib/stores/repo'
import { repo_kind } from '$lib/kinds'
import { getCacheEventsForFilters } from '$lib/dbs/LocalRelayDb'

export type WebSocketUrl = `wss://${string}` | `ws://${string}`

export function isWebSocketUrl(url: string): url is WebSocketUrl {
  return !!safeRelayUrl(url)
}

class RelaysManager {
  base_relays: WebSocketUrl[] = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://purplerelay.com', // reliability untested
    // 'wss://relayable.org', // free but not so reliable
  ]
  relays: Map<WebSocketUrl, RelayManager> = new Map()

  // cache_relay_db: NostrIDB | undefined = undefined
  // async getCacheRelayDb() {
  //   await this.getCacheRelay()
  //   this.cache_relay_db as NostrIDB
  // }
  // async getCacheRelay() {
  //   const url = 'ws://nostr-idb-local'
  //   const relay = this.relays.get(url)
  //   if (!relay) {
  //     this.cache_relay_db = await openDB('LocalStorageRelay')
  //     this.relays.set(
  //       url,
  //       new RelayManager(url, new CacheRelay(this.cache_relay_db))
  //     )
  //   }
  //   return relay
  // }

  get(url: WebSocketUrl) {
    const relay = this.relays.get(url)
    if (relay) return relay
    else {
      const relay = new RelayManager(url)
      this.relays.set(url, relay)
      return relay
    }
  }

  async fetchRepoAnn(
    a: ARef,
    naddr_relays: WebSocketUrl[] | undefined = undefined
  ) {
    const relay_urls = await chooseRelaysForRepo(a, naddr_relays)
    await Promise.all(
      relay_urls.map(async (r) => {
        let relay = this.relays.get(r)
        if (!relay) {
          relay = new RelayManager(r)
          this.relays.set(r, relay)
        }
        await relay.fetchRepoAnn(a)
      })
    )
  }

  async fetchRepoAnnNow(
    a: ARef,
    naddr_relays: string[] | undefined = undefined
  ) {
    const relay_urls = await chooseRelaysForRepo(a, naddr_relays)
    await Promise.all(
      relay_urls.map(async (r) => {
        let relay = this.relays.get(r)
        if (!relay) {
          relay = new RelayManager(r)
          this.relays.set(r, relay)
        }
        await relay.fetchRepoAnnNow(a)
      })
    )
  }

  async fetchAllRepos() {
    const relays = await chooseRelaysForAllRepos()
    Promise.all(relays.map((url) => this.get(url).fetchAllRepos()))
  }

  async fetchPubKeyRepos(pubkey: PubKeyString | undefined) {
    if (!pubkey) return
    // TODO only ask relays if we haven't done it in last 10 seconds
    // TODO: check if user has existing repos and factor in those relay hints
    // TODO: create chooseLikelyRepoRelaysForPubkey function
    const relays = await chooseRelaysForPubkey(pubkey)
    Promise.all(
      relays.slice(0, 4).map((url) => this.get(url).fetchPubKeyRepos(pubkey))
    )
  }

  async fetchIssuesAndPRsForRepo(
    a: ARef,
    naddr_relays: string[] | undefined = undefined
  ) {
    const address_pointer = aRefToAddressPointer(a)
    if (!address_pointer || !('identifier' in address_pointer)) return
    const anns = await db.repos
      .where('identifier')
      .equals(address_pointer.identifier)
      .toArray()
    const c = identifierRepoAnnsToRepoCollection(
      anns,
      address_pointer.pubkey,
      address_pointer.identifier
    )
    const a_refs: ARef[] = c.maintainers.map(
      (m) => `${repo_kind}:${m}:${address_pointer.identifier}` as ARef
    )
    const relays = await chooseRelaysForRepo(a, naddr_relays)

    getCacheEventsForFilters([
      {
        kinds: [issue_kind, patch_kind, ...proposal_status_kinds],
        '#a': [a_ref],
      },
    ])

    sub.unsubscribe()
    // const subscription = memory_db.inserted.subscribe({
    //   next(event: Event) {
    //     if (proposal_status_kinds.includes(event.kind)) {
    //       await processStatusEvent(event)
    //       return
    //     }
    //     events_for_local.push(event)
    //   },
    // })
    // get local events

    events_for_local = []
    // get events from relays
    await Promise.all(
      relays
        .slice(0, 4)
        .map((url) => this.get(url).fetchIssuesAndPRsForRepo(a_refs))
    )
    subscription.unsubscribe()
    // save new events from relays to local
    for (const event of events_for_local) {
      cache_relay.relay.publish(event)
    }
  }

  fetchPubkeyInfoWithObserable(
    pubkey: PubKeyString,
    only_if_old: boolean = true
  ) {
    if (isHexKey(pubkey)) {
      this.fetchPubkeyInfo(pubkey, only_if_old)
    }
    return liveQuery(async () => {
      const info = await db.pubkeys.get(pubkey)
      return info || createPubKeyInfo(pubkey)
    })
  }

  // returns urls of relays selected to query
  async fetchPubkeyInfo(
    pubkey: PubKeyString,
    only_if_old: boolean = true
  ): Promise<string[]> {
    const info = await db.pubkeys.get(pubkey)
    if (info) {
      const checked_recently = [...info.metadata.seen_on].some(
        ([_, seen_on_relay]) => {
          const unix_30_days = 30 * 24 * 60 * 60
          return (
            seen_on_relay.up_to_date &&
            seen_on_relay.last_check + unix_30_days > unixNow()
          )
        }
      )
      if (only_if_old && checked_recently) return []
    }
    const relay_urls = await chooseRelaysForPubkey(pubkey)
    return relay_urls.slice(0, 2).map((url) => {
      relays_manager.get(url).fetchPubkeyInfo(pubkey)
      return url
    })

    // TODO: if failure move on to next in array
    // TODO: do one at a time and stop when we tried one of their outbox relays
    // TODO: if we get new write relay list, if we havn;t recently fetched from 1 on the list, fetch again
  }

  async awaitPubKeyInfo(
    pubkey: PubKeyString,
    only_if_old: boolean = true
  ): Promise<PubKeyInfo> {
    const now = Date.now()
    const relays = await this.fetchPubkeyInfo(pubkey, only_if_old)
    return new Promise((r) => {
      const unsubscriber = liveQuery(async () => {
        const info = await db.pubkeys.get(pubkey)
        return info || createPubKeyInfo(pubkey)
      }).subscribe((info) => {
        if (
          relays.every((url) => {
            const metadata = info.metadata.seen_on.get(url)
            const relay = info.relays.seen_on.get(url)
            if (metadata && relay)
              return metadata.last_check >= now && relay.last_check >= now
            return false
          })
        ) {
          unsubscriber()
          r(info)
        }
      }).unsubscribe
    })
  }
}

export const relays_manager = new RelaysManager()
