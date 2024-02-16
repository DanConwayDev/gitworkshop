<script lang="ts">
  import { login } from '$lib/stores/users'

  export let sendReply: (content: string) => void = () => {}
  export let submitting = false
  export let logged_in = false
  let submit = () => {
    if (!logged_in) login()
    sendReply(content)
  }
  let content = ''
</script>

<div class="">
  <textarea
    disabled={submitting}
    bind:value={content}
    class="textarea textarea-primary w-full"
    placeholder="reply..."
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
