<script lang="ts" context="module">
  export interface Args {
    name: string;
    description: string;
    repo_id: string;
    loading?: boolean;
  }
  export const defaults: Args = {
    name: "",
    repo_id: "",
    description: "",
    loading: false,
  };
</script>

<script lang="ts">
  import { slide } from "svelte/transition";

  export let { name, description, repo_id: repo_id, loading } = defaults;
  let short_name: string;
  $: {
    if (name.length > 45) short_name = name.slice(0, 45) + "...";
    else if (name.length == 0) short_name = "Untitled";
    else short_name = name;
  }
  $: short_descrption =
    description.length > 50 ? description.slice(0, 45) + "..." : description;
</script>

{#if loading}
  <div
    transition:slide={{ duration: 50 }}
    class="card w-96 bg-neutral text-neutral-focus"
  >
    <div class="card-body">
      <div class="text-center">
        <span class="loading loading-spinner loading-lg text-base-100" />
      </div>
    </div>
  </div>
{:else}
  <a
    transition:slide={{ duration: 50 }}
    class="card w-96 bg-primary text-primary-content"
    href="/repo/{repo_id}"
  >
    <div class="card-body">
      <h2 class="card-title">{short_name}</h2>
      <p>{short_descrption}</p>
    </div>
  </a>
{/if}

<style>
  h2 {
    display: inline-block;
  }
  p,
  h2 {
    word-wrap: break-word;
  }
</style>
