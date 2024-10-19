import db from '$lib/dbs/LocalDb'
import {
  createPubKeyInfo,
  eventToIssue,
  eventToPrRoot,
  eventToRepoAnn,
  extractOrCreateSeenOnRelay,
  repoToARef,
  type ARef,
  type AtLeastThreeArray,
  type PubKeyInfo,
  type PubKeyString,
  type RepoAnn,
} from '$lib/dbs/types'
import { issue_kind, patch_kind, repo_kind } from '$lib/kinds'
import { aToAddressPointerAndARef } from '$lib/utils'
import {
  getInboxes,
  getOutboxes,
  getProfileContent,
  getSeenRelays,
  isHexKey,
  unixNow,
} from 'applesauce-core/helpers'
import { Relay } from 'nostr-tools'
import { type AddressPointer } from 'nostr-tools/nip19'
import { base_relays } from './ndk'
import { Metadata, RelayList } from 'nostr-tools/kinds'
import { liveQuery } from 'dexie'
import { aRefToAddressPointer } from '$lib/components/repo/utils'
import { identifierRepoAnnsToRepoCollection } from './repo'

class RelayManager {
  url: string
  repo_queue: Set<ARef> = new Set()
  pubkey_metadata_queue: Set<PubKeyString> = new Set()
  set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined
  set_pubkey_queue_timeout: ReturnType<typeof setTimeout> | undefined =
    undefined
  relay: Relay
  inactivity_timer: NodeJS.Timeout | null = null

  constructor(url: string) {
    this.url = url
    this.relay = new Relay(url)
  }

  async connect(): Promise<void> {
    this.resetInactivityTimer()
    if (!this.relay.connected) {
      await this.relay.connect()
    }
    this.resetInactivityTimer()
  }

  resetInactivityTimer() {
    if (this.inactivity_timer) {
      clearTimeout(this.inactivity_timer)
    }
    this.inactivity_timer = setTimeout(() => {
      this.relay.close()
    }, 10000) // 10 seconds of inactivity
  }

  closeRelayAfterInactivity() {
    this.resetInactivityTimer() // Start the inactivity timer
  }

  async fetchRepoAnn(a: ARef) {
    this.repo_queue.add(a)
    await this.connect()
    if (!this.set_repo_queue_timeout) {
      this.set_repo_queue_timeout = setTimeout(
        async () => this.fetchRepoAnnQueue(),
        200
      )
    }
  }

  async fetchRepoAnnNow(a: ARef) {
    this.repo_queue.add(a)
    await this.fetchRepoAnnQueue()
  }
  async fetchRepoAnnQueue() {
    if (this.set_repo_queue_timeout) clearTimeout(this.set_repo_queue_timeout)

    return new Promise<void>(async (resolve, reject) => {
      // Set a timeout for the reject response
      const timeout = setTimeout(() => {
        sub.close() // Close the subscription if it times out
        reject(
          new Error(
            this.relay.connected ? 'connection timeout' : 'no eose recieved'
          )
        )
      }, 5000)
      await this.connect()
      const identifiers = new Set<string>()
      this.repo_queue.forEach((v) => {
        try {
          identifiers.add(v.split(':')[2])
        } catch {}
      })
      this.repo_queue.clear()
      const found = new Set<string>()
      const sub = this.relay.subscribe(
        [
          {
            kinds: [repo_kind],
            '#d': [...identifiers],
          },
        ],
        {
          onevent: async (event) => {
            const repo_ann = eventToRepoAnn(event)
            if (!repo_ann) return
            found.add(repo_ann.uuid)
            processRepoAnnFromRelay(repo_ann, this.url)
          },
          oneose: async () => {
            sub.close()
            this.resetInactivityTimer()
            const not_on_relays = await db.repos
              .where('identifier')
              .anyOf([...identifiers])
              .filter((repo) => !found.has(repo.uuid))
              .toArray()
            for (const entry of not_on_relays) {
              entry.seen_on.set(this.url, {
                ...extractOrCreateSeenOnRelay(entry, this.url),
                last_check: unixNow(),
                seen: false,
                up_to_date: false,
              })
              db.repos.put(entry)
            }
            clearTimeout(timeout)
            resolve()
          },
        }
      )
    })
  }

  async fetchRepos() {}

  async fetchAllRepos() {
    const checks = await db.last_checks.get(`${this.url}|`)
    if (
      checks &&
      checks.check_initiated_at &&
      checks.check_initiated_at > Date.now() - 3000
    )
      return
    db.last_checks.put({
      url_and_query: `${this.url}|`,
      url: this.url,
      check_initiated_at: Date.now(),
      timestamp: checks ? checks.timestamp : 0,
      // timestamp: unixNow(),
      query: 'All Repos',
    })
    await this.connect()
    return new Promise<void>((r) => {
      const sub = this.relay.subscribe(
        [
          {
            kinds: [repo_kind],
            since: checks ? checks.timestamp - 60 * 10 : 0,
            // TODO: what if this last check failed to reach the relay?
            // limit: 100,
            // TODO request next batch if 100 recieved
          },
        ],
        {
          onevent: async (event) => {
            const repo_ann = eventToRepoAnn(event)
            if (!repo_ann) return
            processRepoAnnFromRelay(repo_ann, this.url)
          },
          oneose: async () => {
            sub.close()
            this.resetInactivityTimer()
            db.last_checks.put({
              url_and_query: `${this.url}|`,
              url: this.url,
              check_initiated_at: undefined,
              timestamp: unixNow(),
              query: 'All Repos',
            })
            r()
          },
        }
      )
    })
  }

  async fetchPubKeyRepos(pubkey: PubKeyString) {
    await this.connect()
    const info = (await db.pubkeys.get(pubkey)) || createPubKeyInfo(pubkey)
    const seen_on = info.metadata.seen_on.get(this.url)
    if (
      seen_on &&
      seen_on.children_check_initiated_at &&
      seen_on.children_check_initiated_at > Date.now() - 3000
    )
      return
    const new_seen_on = {
      ...extractOrCreateSeenOnRelay(info.metadata, this.url),
      children_check_initiated_at: Date.now(),
    }
    info.metadata.seen_on.set(this.url, new_seen_on)
    await db.pubkeys.put(info, pubkey)

    return new Promise<void>((r) => {
      const sub = this.relay.subscribe(
        [
          {
            kinds: [repo_kind],
            since: new_seen_on.last_check
              ? new_seen_on.last_check - 60 * 10
              : 0,
            // TODO: what if this last check failed to reach the relay?
            authors: [pubkey],
          },
        ],
        {
          onevent: async (event) => {
            const repo_ann = eventToRepoAnn(event)
            if (!repo_ann) return
            processRepoAnnFromRelay(repo_ann, this.url)
          },
          oneose: async () => {
            const info =
              (await db.pubkeys.get(pubkey)) || createPubKeyInfo(pubkey)
            info.metadata.seen_on.set(this.url, {
              ...extractOrCreateSeenOnRelay(info.metadata, this.url),
              children_check_initiated_at: undefined,
              last_children_check: unixNow(),
            })
            await db.pubkeys.put(info, pubkey)
            sub.close()
            this.resetInactivityTimer()
            r()
          },
        }
      )
    })
  }

  async fetchPubkeyInfo(pubkey: PubKeyString) {
    this.pubkey_metadata_queue.add(pubkey)
    await this.connect()
    if (!this.set_pubkey_queue_timeout) {
      this.set_pubkey_queue_timeout = setTimeout(
        async () => this.fetchPubkeyQueue(),
        200
      )
    }
  }

  async fetchPubkeyQueue() {
    await this.connect()
    const pubkeys = [...this.pubkey_metadata_queue]
    this.pubkey_metadata_queue.clear()
    clearTimeout(this.set_pubkey_queue_timeout)
    const found_metadata = new Set<string>()
    const found_relay_list = new Set<string>()
    const sub = this.relay.subscribe(
      [
        {
          kinds: [Metadata, RelayList],
          authors: pubkeys,
        },
      ],
      {
        onevent: async (event) => {
          const original =
            (await db.pubkeys.get(event.pubkey)) ||
            createPubKeyInfo(event.pubkey)
          if (event.kind === Metadata) {
            try {
              const profile = getProfileContent(event)
              if (!profile) return
              found_metadata.add(event.pubkey)
              const seen_on = original.metadata.seen_on
              const seen_on_relay = {
                ...extractOrCreateSeenOnRelay(original.metadata, this.url),
                last_check: unixNow(),
                seen: true,
                up_to_date:
                  !original.metadata.stamp ||
                  original.metadata.stamp.event_id == event.id ||
                  original.metadata.stamp.created_at < event.created_at,
              }
              seen_on.set(this.url, seen_on_relay)

              db.pubkeys.put({
                ...original,
                metadata:
                  original.metadata.stamp &&
                  original.metadata.stamp.event_id === event.id
                    ? {
                        ...original.metadata,
                        seen_on,
                      }
                    : {
                        fields: profile,
                        stamp: {
                          event_id: event.id,
                          created_at: event.created_at,
                        },
                        seen_on,
                      },
              })
              setTimeout(async () => {
                const latest = await db.pubkeys.get(event.pubkey)
                if (
                  latest &&
                  latest.metadata.stamp &&
                  latest.metadata.stamp.event_id !== event.id &&
                  seen_on_relay.up_to_date
                ) {
                  const latest_seen_on = latest.metadata.seen_on
                  if (
                    seen_on_relay.last_check ===
                    latest_seen_on.get(this.url)?.last_check
                  ) {
                    latest_seen_on.set(this.url, {
                      ...extractOrCreateSeenOnRelay(latest.metadata, this.url),
                      last_check: unixNow(),
                      seen: true,
                      up_to_date: false,
                    })
                    db.pubkeys.put({
                      ...latest,
                      metadata: {
                        ...latest.metadata,
                        seen_on: latest_seen_on,
                      },
                    })
                  }
                }
              }, 1000)
            } catch {}
          } else if (event.kind === RelayList) {
            const read = getInboxes(event)
            const write = getOutboxes(event)
            const profile = getSeenRelays(event)
            if (!profile) return
            found_relay_list.add(event.pubkey)
            const seen_on = original.relays.seen_on
            const seen_on_relay = {
              ...extractOrCreateSeenOnRelay(original.metadata, this.url),
              last_check: unixNow(),
              seen: true,
              up_to_date:
                !original.relays.stamp ||
                original.relays.stamp.event_id == event.id ||
                original.relays.stamp.created_at < event.created_at,
            }
            seen_on.set(this.url, seen_on_relay)

            db.pubkeys.put({
              ...original,
              relays: seen_on_relay.up_to_date
                ? {
                    ...original.relays,
                    seen_on,
                  }
                : {
                    read: [...read],
                    write: [...write],
                    relay_hints_found: original.relays.relay_hints_found,
                    stamp: {
                      event_id: event.id,
                      created_at: event.created_at,
                    },
                    seen_on,
                  },
            })
            setTimeout(async () => {
              const latest = await db.pubkeys.get(event.pubkey)
              if (
                latest &&
                latest.relays.stamp &&
                latest.relays.stamp.event_id == event.id &&
                seen_on_relay.up_to_date
              ) {
                const latest_seen_on = latest.relays.seen_on
                if (
                  seen_on_relay.last_check ===
                  latest_seen_on.get(this.url)?.last_check
                ) {
                  latest_seen_on.set(this.url, {
                    ...extractOrCreateSeenOnRelay(latest.relays, this.url),
                    last_check: unixNow(),
                    seen: true,
                    up_to_date: false,
                  })
                  db.pubkeys.put({
                    ...latest,
                    relays: {
                      ...latest.relays,
                      seen_on: latest_seen_on,
                    },
                  })
                }
              }
            }, 1000)
          }
        },
        oneose: async () => {
          sub.close()
          this.resetInactivityTimer()
          const pubkeys_set = new Set(pubkeys)
          const missing_metadata =
            found_metadata.symmetricDifference(pubkeys_set)
          const missing_relays =
            found_relay_list.symmetricDifference(pubkeys_set)

          const missing_any = new Set([
            ...found_metadata,
            ...found_relay_list,
          ]).symmetricDifference(pubkeys_set)
          for (const pubkey of [...missing_any]) {
            const record =
              (await db.pubkeys.get(pubkey)) || createPubKeyInfo(pubkey)
            if (missing_metadata.has(pubkey))
              record.metadata.seen_on.set(this.url, {
                ...extractOrCreateSeenOnRelay(record.metadata, this.url),
                last_check: unixNow(),
                seen: false,
                up_to_date: false,
              })
            if (missing_relays.has(pubkey))
              record.relays.seen_on.set(this.url, {
                ...extractOrCreateSeenOnRelay(record.relays, this.url),
                last_check: unixNow(),
                seen: false,
                up_to_date: false,
              })
            await db.pubkeys.put(record, pubkey)
          }
        },
      }
    )
  }

  async fetchIssuesAndPRsForRepo(a_refs: ARef[]) {
    await this.connect()
    const anns = (await db.repos.bulkGet(a_refs)).filter((ann) => !!ann)
    if (
      anns.length === a_refs.length &&
      anns.every(
        (ann) =>
          ann.seen_on.get(this.url)?.children_check_initiated_at ||
          0 > Date.now() - 5000 ||
          false
      )
    )
      anns.forEach((ann) => {
        ann.seen_on.set(this.url, {
          ...extractOrCreateSeenOnRelay(ann, this.url),
          children_check_initiated_at: Date.now(),
        })
      })
    await db.repos.bulkPut(anns)
    const filters = a_refs.map((a_ref) => ({
      kinds: [issue_kind, patch_kind],
      '#a': [a_ref],
      since:
        anns
          .map((ann) =>
            a_ref === repoToARef(ann)
              ? // TODO: last check minus 10 minutes
                ann.seen_on.get(this.url)?.last_children_check
              : undefined
          )
          .find((v) => !!v) || undefined,
    }))

    // TODO: since
    await new Promise<void>((r) => {
      this.relay.subscribe(filters, {
        onevent: async (event) => {
          const issue_or_pr = eventToIssue(event) || eventToPrRoot(event)
          if (issue_or_pr) {
            const table = issue_or_pr.kind === issue_kind ? db.issues : db.prs
            const record = await table.get(event.id)
            const seen_on_relay = {
              ...extractOrCreateSeenOnRelay(record, this.url),
              last_check: unixNow(),
              seen: true,
              up_to_date: true,
            }
            if (!record) {
              const seen_on = new Map()
              seen_on.set(this.url, seen_on_relay)
              table.add({
                ...issue_or_pr,
                seen_on,
              })
            } else {
              record.seen_on.set(this.url, seen_on_relay)
              table.put(record)
            }
          }
        },
        oneose: async () => {
          const anns = (await db.repos.bulkGet(a_refs)).filter((ann) => !!ann)
          anns.forEach((ann) => {
            ann.seen_on.set(this.url, {
              ...extractOrCreateSeenOnRelay(ann, this.url),
              children_check_initiated_at: undefined,
              check_initiated_at: unixNow(),
            })
          })
          await db.repos.bulkPut(anns)

          // TODO: update last check for
          r()
        },
      })
    })
    // await new Promise<void>(async (r) => {
    //   // get status and replies
    //   let issues = db.issues
    //     .where('parent_ids').anyOf(a_refs).toArray();

    //     this.relay.subscribe(
    //       [{ kinds: [ ...proposal_status_kinds, 1], '#a': a_refs }],
    //       {
    //         onevent: async (event) => {
    //           const issue_or_pr = eventToIssue(event) || eventToPrRoot(event)
    //           if (issue_or_pr) {
    //             const table =
    //               issue_or_pr.kind === issue_kind ? db.issues : db.prs
    //             const seen_on_relay = {
    //               last_check: unixNow(),
    //               seen: true,
    //               up_to_date: true,
    //             }
    //             const record = await table.get(event.id)
    //             if (!record) {
    //               const seen_on = new Map()
    //               seen_on.set(this.url, seen_on_relay)
    //               table.add({
    //                 ...issue_or_pr,
    //                 seen_on,
    //               })
    //             } else {
    //               record.seen_on.set(this.url, seen_on_relay)
    //               table.put(record)
    //             }
    //           }
    //         },
    //         oneose: async () => {
    //           r()
    //         },
    //       }
    //     )
    // })
    // for each PR and Issue (and in db) get responses and responses to each response
    // get new PRs and Repos
    // find responses
  }
}

class RelaysManager {
  relays: Map<string, RelayManager> = new Map()

  get(url: string) {
    const relay = this.relays.get(url)
    if (relay) return relay
    else {
      const relay = new RelayManager(url)
      this.relays.set(url, relay)
      return relay
    }
  }

  async fetchRepoAnn(a: ARef, naddr_relays: string[] | undefined = undefined) {
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
    if (!address_pointer) return
    const anns = await db.repos
      .where('identifier')
      .equals(address_pointer?.identifier)
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

    Promise.all(
      relays
        .slice(0, 4)
        .map((url) => this.get(url).fetchIssuesAndPRsForRepo(a_refs))
    )
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

const processRepoAnnFromRelay = async (
  repo_ann: RepoAnn,
  relay_url: string
) => {
  const original = await db.repos.get(repo_ann.uuid)
  const seen_on = original ? original.seen_on : new Map()
  const seen_on_relay = {
    ...extractOrCreateSeenOnRelay(original, relay_url),
    last_check: unixNow(),
    seen: true,
    up_to_date:
      !original ||
      original.event_id == repo_ann.event_id ||
      original.created_at < repo_ann.created_at,
  }
  seen_on.set(relay_url, seen_on_relay)
  db.repos.put({
    ...(!original || seen_on_relay.up_to_date ? repo_ann : original),
    seen_on,
  })
  setTimeout(async () => {
    const latest = await db.repos.get(repo_ann.uuid)
    if (
      latest &&
      latest.event_id !== repo_ann.event_id &&
      seen_on_relay.up_to_date
    ) {
      const latest_seen_on = latest?.seen_on
      if (
        seen_on_relay.last_check === latest_seen_on.get(relay_url)?.last_check
      ) {
        latest_seen_on.set(relay_url, {
          ...extractOrCreateSeenOnRelay(latest, relay_url),
          last_check: unixNow(),
          seen: true,
          up_to_date: false,
        })
        db.repos.put({
          ...repo_ann,
          seen_on: latest_seen_on,
        })
      }
    }
  }, 1000)
}

const chooseRelaysForAllRepos = async () => {
  // TODO: expand this to more relays and fetch for different relays each time
  const results = await Promise.all(
    base_relays.map(async (url) => {
      const checks = await db.last_checks.get(`${url}|`)
      if (!checks) return true
      if (checks.timestamp * 1000 < Date.now() - 5000) return true
      return false
    })
  )

  return base_relays.filter((_, index) => results[index])
}

const chooseRelaysForRepo = async (
  a: AddressPointer | ARef,
  naddr_relays: string[] | undefined = undefined
): Promise<string[]> => {
  const pointer_and_a_ref = aToAddressPointerAndARef(a)
  const urls = new Set<string>(naddr_relays || [])
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
        urls.add(url)
      })
      repo_ann.seen_on.forEach((value, url) => {
        if (value.seen) urls.add(url)
      })
    }
  }
  base_relays.forEach((url) => {
    urls.add(url)
  })
  return [...urls].slice(0, 3)
}

const chooseRelaysForPubkey = async (
  pubkey: PubKeyString
): Promise<AtLeastThreeArray<string>> => {
  // is relay connected?
  // has relay got items in queue?
  const record = await db.pubkeys.get(pubkey)
  const urls = new Set<string>()
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
    seen_on_priority.forEach((seen_on: string[]) => {
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
  base_relays.forEach((url) => {
    urls.add(url)
  })
  return [...urls] as AtLeastThreeArray<string>
  // return [...urls].slice(0, 3)
}

const relays_manager = new RelaysManager()
export default relays_manager
