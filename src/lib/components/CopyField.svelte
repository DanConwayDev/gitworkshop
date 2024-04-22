<script lang="ts">
  import { icons_misc } from './icons'

  export let label: string = ''
  export let content: string = ''
  export let border_color = 'primary'
  let copied = false
</script>

<!-- eslint-disable-next-line svelte/valid-compile -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="group mt-3 cursor-pointer"
  on:click={async () => {
    try {
      await navigator.clipboard.writeText(content)
      copied = true
      setTimeout(() => {
        copied = false
      }, 2000)
    } catch {}
  }}
>
  {label}
  {#if copied}<span class="text-sm text-success opacity-50">
      (copied to clipboard)</span
    >{/if}
  <div
    class="items mt-1 flex w-full items-center rounded-lg border border-{border_color} p-3 opacity-50"
    class:text-success={copied}
  >
    <div class="flex-auto truncate text-sm">
      {content}
    </div>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50 group-hover:opacity-100"
      class:opacity-100={copied}
      class:fill-success={copied}
    >
      {#each icons_misc.copy as d}
        <path {d} />
      {/each}
    </svg>
  </div>
</div>
