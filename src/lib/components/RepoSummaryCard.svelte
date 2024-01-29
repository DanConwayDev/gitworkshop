<script lang="ts" context="module">
  export interface Args {
    name: string;
    description: string;
    repo_id: string;
    loading?: boolean;
    created_at: number;
  }
  export const defaults: Args = {
    name: "",
    repo_id: "",
    description: "",
    loading: false,
    created_at: 0,
  };
</script>

<script lang="ts">
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

<div class="p-4 bg-base-200 my-2 rounded-lg">
  {#if loading}
    <div class="h-5 mb-2 skeleton w-40"></div>
    <div class="h-4 skeleton w-100"></div>
  {:else}
    <a class="link-primary break-words" href="/repo/{repo_id}">{short_name}</a>
    <p class="text-sm text-muted break-words">{short_descrption}</p>
  {/if}
</div>
