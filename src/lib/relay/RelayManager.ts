import type { ARef, PubKeyString } from '$lib/dbs/types'
import { repo_kind } from '$lib/kinds'
import { CacheRelay } from 'nostr-idb'
import { Relay } from 'nostr-tools'
import type { Subscription } from 'nostr-tools/abstract-relay'
import type { WebSocketUrl } from './RelaysManager'

export class RelayManager {
  url: WebSocketUrl
  repo_queue: Set<ARef> = new Set()
  pubkey_metadata_queue: Set<PubKeyString> = new Set()
  set_repo_queue_timeout: ReturnType<typeof setTimeout> | undefined = undefined
  set_pubkey_queue_timeout: ReturnType<typeof setTimeout> | undefined =
    undefined
  relay: Relay | CacheRelay
  inactivity_timer: NodeJS.Timeout | null = null

  constructor(url: string, relay: Relay | CacheRelay | undefined = undefined) {
    this.url = url
    if (relay) this.relay = relay
    else {
      this.relay = new Relay(url)
    }
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
    let sub: Subscription | undefined
    return new Promise<void>(async (resolve) => {
      // Set a timeout for the reject response
      const timeout_ms = 5000
      const timeout = setTimeout(() => {
        if (sub) sub.close() // Close the subscription if it times out
        resolve()
        // reject(
        //   new Error(
        //     `${this.url} ${this.relay.connected ? 'connection timeout' : 'no eose recieved'} after ${timeout_ms / 1000}`
        //   )
        // )
      }, timeout_ms)
      await this.connect()
      const identifiers = new Set<string>()
      this.repo_queue.forEach((v) => {
        try {
          identifiers.add(v.split(':')[2])
        } catch {}
      })
      this.repo_queue.clear()
      const found = new Set<string>()
      sub = this.relay.subscribe(
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
            if (sub) sub.close()
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

  tmp_statuses: Event[] = []
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
      kinds: [issue_kind, patch_kind, ...proposal_status_kinds],
      '#a': [a_ref],
      since:
        anns
          .map((ann) => {
            if (a_ref === repoToARef(ann)) {
              const seen_on = ann.seen_on.get(this.url)
              if (seen_on) {
                const ten_minutes = 10 * 60
                if (seen_on.last_children_check > ten_minutes) {
                  return seen_on.last_children_check - ten_minutes
                } else {
                  // seen_on.last_children_check defaults to 0
                  return seen_on.last_children_check
                }
              }
            }
            return undefined
          })
          .find((v) => !!v) || undefined,
    }))

    if (this.url !== 'ws://nostr-idb-local')
      await new Promise<void>((r) => {
        this.relay.subscribe(filters, {
          onevent: async (event) => {
            if (proposal_status_kinds.includes(event.kind)) {
              const processed = processStatusEvent(event)
              if (!processed) this.tmp_statuses.push(event)
              return
            }
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
                last_children_check: unixNow(),
              })
            })
            await db.repos.bulkPut(anns)
            for (const event of this.tmp_statuses) {
              await processStatusEvent(event)
            }
            this.tmp_statuses = []
            r()
          },
        })
      })

    await new Promise<void>(async (r) => {
      // get status and replies
      const comment_filters = []
      for (const filter of filters) {
        const issues = await db.issues
          .filter((e) => e.parent_ids.includes(filter['#a'][0]))
          .toArray()
        const prs = await db.prs
          .filter((e) => e.parent_ids.includes(filter['#a'][0]))
          .toArray()
        if (issues.length > 0 || prs.length > 0)
          comment_filters.push({
            kinds: [...proposal_status_kinds, 1],
            '#e': [...issues.map((v) => v.uuid), ...prs.map((v) => v.uuid)],
            since: filter.since,
          })
      }

      if (comment_filters.length > 0)
        this.relay.subscribe(comment_filters, {
          onevent: async (event) => {
            const newly_inserted = memory_db.addEvent(event) === event
            if (newly_inserted)
              (await relays_manager.getCacheRelay()).publish(event)
          },
          oneose: async () => {
            r()
          },
        })
      else r()
    })
    // for each PR and Issue (and in db) get responses and responses to each response
    // get new PRs and Repos
    // find responses
  }
}
