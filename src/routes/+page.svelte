<script lang="ts">
  import ReposRecent from "$lib/wrappers/ReposRecent.svelte";
</script>

<div class="flex flex-row">
  <div class="hero bg-pr h-[calc(100vh-4rem)] md:basis-1/2">
    <div class="hero-content text-center">
      <div class="max-w-md prose">
        <h1 class="mb-2">
          <span class="text-purple-600">git</span><span class="text-white"
            >workshop</span
          ><span class="text-neutral">.dev</span>
        </h1>
        <p class="mt-3">permissionless alternative to GitHub over nostr</p>
      </div>
    </div>
  </div>
  <div class="hero h-[calc(100vh-4rem)] md:basis-1/2">
    <ReposRecent />
  </div>
</div>
