<script lang="ts">
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import type { RepoSummary } from '$lib/components/repo/type'
  import type { User } from '$lib/components/users/type'
  import { repo_kind } from '$lib/kinds'
  import { ndk } from '$lib/stores/ndk'
  import { ensureUser } from '$lib/stores/users'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'
  import type { Unsubscriber } from 'svelte/store'

  export let limit: number = 10

  let repos: RepoSummary[] = []
  let loading: boolean = true
  let sub = ndk.subscribe({
    kinds: [repo_kind],
    limit,
  })
  let maintainers_unsubscribers: Unsubscriber[] = []
  sub.on('event', (event: NDKEvent) => {
    if (repos.length < limit) {
      try {
        if (event.kind == repo_kind) {
          const maintainers = [
            {
              hexpubkey: event.pubkey,
              loading: true,
              npub: '',
            } as User,
          ]
          event.getMatchingTags('maintainers').forEach((t: string[]) => {
            t.forEach((v, i) => {
              if (i > 0 && v !== maintainers[0].hexpubkey) {
                maintainers.push({
                  hexpubkey: v,
                  loading: true,
                  npub: '',
                } as User)
              }
            })
          })
          // not duplicate name
          if (!repos.some((r) => r.repo_id == event.replaceableDTag())) {
            repos = [
              ...repos,
              {
                name: event.tagValue('name') || '',
                description: event.tagValue('description') || '',
                repo_id: event.replaceableDTag(),
                maintainers,
                created_at: event.created_at || 0,
              },
            ]
          } else {
            // duplicate name
            repos = [
              ...repos.map((r) => {
                if (event.created_at && r.repo_id == event.replaceableDTag()) {
                  let new_maintainers = maintainers.filter(
                    (m) =>
                      !r.maintainers.some((o) => o.hexpubkey == m.hexpubkey)
                  )
                  return {
                    name:
                      r.created_at < event.created_at
                        ? event.tagValue('name') || r.name
                        : r.name,
                    description:
                      r.created_at < event.created_at
                        ? event.tagValue('description') || r.description
                        : r.description,
                    repo_id: r.repo_id,
                    maintainers: [...r.maintainers, ...new_maintainers],
                    created_at:
                      r.created_at < event.created_at
                        ? event.created_at
                        : r.created_at,
                  }
                } else return { ...r }
              }),
            ]
          }
          // get maintainers profile
          maintainers.forEach((m) => {
            maintainers_unsubscribers.push(
              ensureUser(m.hexpubkey).subscribe((u: User) => {
                repos = repos.map((r) => {
                  return {
                    ...r,
                    maintainers: r.maintainers.map((m) => {
                      if (m.hexpubkey == u.hexpubkey) return { ...u }
                      else return { ...m }
                    }),
                  }
                })
              })
            )
          })
        }
      } catch {}
    } else if (loading == true) loading = false
  })
  sub.on('eose', () => {
    if (loading == true) loading = false
  })

  onDestroy(() => {
    maintainers_unsubscribers.forEach((unsubscriber) => unsubscriber())
    sub.stop()
  })
</script>

<ReposSummaryList title="Latest Repositories" {repos} {loading} />
