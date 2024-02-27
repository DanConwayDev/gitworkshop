<script lang="ts">
  import { logged_in_user, login } from '$lib/stores/users'
  import UserHeader from '../users/UserHeader.svelte'
  import { defaults as user_defaults } from '../users/type'

  export let sendReply: (content: string) => void = () => {}
  export let placeholder = 'reply...'
  export let submitting = false
  export let logged_in = false
  let submit = () => {
    if (!logged_in) login()
    sendReply(content)
  }
  let content = ''
</script>

<div class="flex pt-5">
  <div class="mt-0 flex-none px-3">
    <UserHeader
      avatar_only={true}
      user={$logged_in_user || { ...user_defaults, loading: false }}
    />
  </div>
  <div class="flex-grow pt-2">
    <textarea
      disabled={submitting}
      bind:value={content}
      class="textarea textarea-primary w-full"
      {placeholder}
    ></textarea>
    <div class="flex">
      <div class="flex-auto"></div>
      <button
        on:click={submit}
        disabled={submitting}
        class="align-right btn btn-primary btn-sm mt-2 align-bottom"
      >
        {#if submitting}
          Sending
        {:else if !logged_in}
          Login before Sending
        {:else}
          Send
        {/if}
      </button>
    </div>
  </div>
</div>
