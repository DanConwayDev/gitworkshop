<script lang="ts">
  import dayjs from 'dayjs'
  import UserHeader from '../users/UserHeader.svelte'
  import type { PubKeyString } from '$lib/dbs/types'

  export let author: PubKeyString
  export let created_at: number | undefined
  let created_at_ago = ''
  $: created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : ''
</script>

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
  <div class="flex">
    <div class="flex-auto">
      <div class="inline text-neutral-400"><slot /></div>
      <div class="badge bg-base-400 text-neutral-400">
        <UserHeader user={author} inline />
      </div>
    </div>
    <span class="m-auto flex-none py-1 text-xs">{created_at_ago}</span>
  </div>
</div>
