<script lang="ts">
  import dayjs from 'dayjs'
  import UserHeader from '../users/UserHeader.svelte'
  import type { User } from '../users/type'
  import { defaults as user_defaults } from '../users/type'
  import ComposeReply from '$lib/wrappers/ComposeReply.svelte'
  import { logged_in_user } from '$lib/stores/users'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let author: User = { ...user_defaults }
  export let created_at: number | undefined
  export let event_id = ''
  export let event: NDKEvent | undefined = undefined
  export let logged_in = $logged_in_user
  let show_compose = false
  let show_raw_json_modal = false
  let created_at_ago = ''
  $: created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : ''
</script>

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
  <div class="flex">
    <div class="flex-auto">
      <UserHeader user={author} />
    </div>
    <span class="m-auto text-xs">{created_at_ago}</span>
    <div class="m-auto ml-2">
      {#if event}
        <div class="tooltip align-middle" data-tip="event json">
          <button
            on:click={() => {
              show_raw_json_modal = true
            }}
            class="btn btn-xs text-neutral-content"
          >
            <!-- https://icon-sets.iconify.design/ph/brackets-curly-bold -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 256 256"
              ><path
                fill="currentColor"
                d="M54.8 119.49a35.06 35.06 0 0 1-5.75 8.51a35.06 35.06 0 0 1 5.75 8.51C60 147.24 60 159.83 60 172c0 25.94 1.84 32 20 32a12 12 0 0 1 0 24c-19.14 0-32.2-6.9-38.8-20.51C36 196.76 36 184.17 36 172c0-25.94-1.84-32-20-32a12 12 0 0 1 0-24c18.16 0 20-6.06 20-32c0-12.17 0-24.76 5.2-35.49C47.8 34.9 60.86 28 80 28a12 12 0 0 1 0 24c-18.16 0-20 6.06-20 32c0 12.17 0 24.76-5.2 35.49M240 116c-18.16 0-20-6.06-20-32c0-12.17 0-24.76-5.2-35.49C208.2 34.9 195.14 28 176 28a12 12 0 0 0 0 24c18.16 0 20 6.06 20 32c0 12.17 0 24.76 5.2 35.49A35.06 35.06 0 0 0 207 128a35.06 35.06 0 0 0-5.75 8.51C196 147.24 196 159.83 196 172c0 25.94-1.84 32-20 32a12 12 0 0 0 0 24c19.14 0 32.2-6.9 38.8-20.51c5.2-10.73 5.2-23.32 5.2-35.49c0-25.94 1.84-32 20-32a12 12 0 0 0 0-24"
              /></svg
            ></button
          >
        </div>
        {#if show_raw_json_modal}
          <div class="modal" class:modal-open={show_raw_json_modal}>
            <div class="text-wrap modal-box max-w-full text-xs">
              <code class="w-full">{JSON.stringify(event.rawEvent())}</code>
              <div class="modal-action">
                <button
                  class="btn btn-sm"
                  on:click={() => (show_raw_json_modal = false)}>Close</button
                >
              </div>
            </div>
          </div>
        {/if}
      {/if}
      {#if !show_compose && logged_in}
        <div class="tooltip align-middle" data-tip="reply">
          <button
            on:click={() => {
              show_compose = true
            }}
            class="btn btn-xs"
            ><svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              ><path
                fill="currentColor"
                d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275a.749.749 0 0 1-.734-.215L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0"
              /></svg
            ></button
          >
        </div>
      {/if}
    </div>
  </div>
  <div class="ml-11">
    <slot />
    {#if show_compose}
      <div class="">
        <div class="flex">
          <div class="flex-auto"></div>
          <button
            on:click={() => {
              show_compose = false
            }}
            class="btn btn-circle btn-ghost btn-sm right-2 top-2">✕</button
          >
        </div>
        <div class="">
          <ComposeReply {type} reply_to_event_id={event_id} />
        </div>
      </div>
    {/if}
  </div>
</div>
