<script lang="ts">
  export let sendReply: (content: string) => void = () => {}
  export let submitting = false
  let submit = () => {
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
      {:else}
        Send
      {/if}
    </button>
  </div>
</div>
