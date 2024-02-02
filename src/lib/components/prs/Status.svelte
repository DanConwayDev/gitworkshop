<script lang="ts">
  import { pr_icon_path } from './icons'

  export let status: string | undefined = undefined
  export let edit_mode = false
</script>

{#if !status}
  <div class="skeleton inline-block h-8 w-24 rounded-md align-middle"></div>
{:else}
  <div
    tabIndex={0}
    role="button"
    class:btn-success={status && status === 'Open'}
    class:btn-primary={status && status === 'Merged'}
    class:btn-neutral={!status || status === 'Draft' || status === 'Closed'}
    class:cursor-default={!edit_mode}
    class="btn btn-success btn-sm align-middle"
  >
    {#if status === 'Open'}
      <!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 18 18"
        class="h-5 w-5 flex-none fill-success-content pt-1"
        ><path d={pr_icon_path.open} />
      </svg>
      Open
    {:else if status === 'Merged'}
      <!-- https://icon-sets.iconify.design/octicon/git-merge-16/ -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="h-5 w-5 flex-none fill-primary-content pt-1"
        ><path d={pr_icon_path.merge} /></svg
      >
      Merged
    {:else if status === 'Closed'}
      <!-- https://icon-sets.iconify.design/octicon/git-pull-request-closed-16/ -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="h-5 w-5 flex-none fill-neutral-content pt-1"
        ><path d={pr_icon_path.close} /></svg
      >
      Closed
    {:else if status === 'Draft'}
      <!-- https://icon-sets.iconify.design/octicon/git-pull-request-draft-16// -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="h-5 w-5 flex-none fill-neutral-content pt-1"
        ><path d={pr_icon_path.draft} /></svg
      >
      Draft
    {:else}
      {status}
    {/if}
    {#if edit_mode}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class="h-5 w-5 flex-none fill-success-content"
        ><path
          fill="currentColor"
          d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
        /></svg
      >
    {/if}
  </div>
{/if}
