<script lang="ts">
  import { icons_misc } from '../icons'

  let show_replies = true
  export let num_replies = 0

  const toggle_replies = () => {
    show_replies = !show_replies
  }
</script>

{#if num_replies > 0}
  <div class="border-l border-blue-500 pl-1">
    {#if show_replies}
      <div class="opacity-20 hover:opacity-70" class:relative={show_replies}>
        <button
          on:click={() => {
            toggle_replies()
          }}
          class=" right-0 -mt-8 p-1"
          class:absolute={show_replies}
        >
          <span class="inline text-xs"
            >{show_replies ? 'hide' : 'show'} {num_replies} replies</span
          >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="inline h-7 w-7 flex-none fill-base-content pt-1"
          >
            {#each show_replies ? icons_misc.chevron_up : icons_misc.chevron_down as p}
              <path d={p} />
            {/each}
          </svg>
        </button>
      </div>
    {:else}
      <button
        on:click={() => {
          toggle_replies()
        }}
        class="w-full cursor-pointer bg-base-300 p-3 text-left hover:bg-base-400"
      >
        show {num_replies} hidden replies
      </button>
    {/if}
    <div class:hidden={!show_replies}>
      <slot />
    </div>
  </div>
{/if}
