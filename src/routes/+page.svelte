<script lang="ts">
  import ReposFeatured from "$lib/components/ReposFeatured.svelte";
</script>

<div class="flex flex-row">
  <div class="hero bg-pr h-[calc(100vh-4rem)] md:basis-1/2">
    <div class="hero-content text-center">
      <div class="max-w-md prose">
        <h1>GitTogether.xyz</h1>
        <h3>Code Collaboration over Nostr</h3>
        <p>Pull Requests, Issues, and Git Branch State</p>
      </div>
    </div>
  </div>
  <div class="hero h-[calc(100vh-4rem)] md:basis-1/2">
    <ReposFeatured />
  </div>
</div>
