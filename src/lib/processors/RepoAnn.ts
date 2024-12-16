import type { NostrEvent } from 'nostr-tools'

async function processRepoAnn(event: NostrEvent) {}

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

export default processRepoAnn
