<script lang="ts">
  import ReposRecent from "$lib/wrappers/ReposRecent.svelte";
</script>

<div class="flex flex-row">
  <div class="hero bg-pr h-[calc(100vh-4rem)] md:basis-1/2">
    <div class="hero-content text-center">
      <div class="max-w-md">
        <div class="prose">
          <h1 class="mb-2">
            <span class="text-purple-600">git</span><span class="text-white"
              >workshop</span
            ><span class="text-neutral">.dev</span>
          </h1>
          <p class="mt-3 mb-8">
            permissionless alternative to GitHub over nostr
          </p>
        </div>
        <div>
          <div class="bg-base-300 card mb-8">
            <div class="card-body items-center text-center">
              <div class="card-title">
                <h3>
                  pairs with <span class="text-purple-600">n</span>git cli
                </h3>
              </div>
              <div class="prose">
                a command-line tool to <span class="badge">create</span>,
                <span class="badge">list</span> and
                <span class="badge">apply</span> PRs and patches
                <div class="card-actions flex mt-3">
                  <div class="flex-grow">
                    <a href="/ngit" class="btn btn-neutral">install ngit</a>
                  </div>
                  <div class="flex-grow">
                    <a href="/ngit" class="btn">learn more</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <button
          on:click={() =>
            alert(
              "install ngit and run `ngit claim` your local git repository",
            )}
          class="btn btn-secondary">list your repository</button
        >
      </div>
    </div>
  </div>
  <div class="hero h-[calc(100vh-4rem)] md:basis-1/2">
    <ReposRecent />
  </div>
</div>
