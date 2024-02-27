<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import PatchesRecent from '$lib/wrappers/RecentProposals.svelte'
  import ReposRecent from '$lib/wrappers/ReposRecent.svelte'
</script>

<div role="alert" class="alert">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="h-6 w-6 shrink-0 stroke-current"
    fill="none"
    viewBox="0 0 24 24"
    ><path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    /></svg
  >
  <div>
    <h3 class="prose text-xs">Warning Experimental: expect breaking changes</h3>
  </div>
</div>

<div class="my-8 flex flex-row">
  <div class="justify-right flex items-center">
    <div class="align-center hero-content text-center">
      <div class="max-w-md">
        <div class="prose">
          <h1 class="mb-2">
            <span class="text-purple-600">git</span><span class="text-white"
              >workshop</span
            ><span class="text-neutral">.dev</span>
          </h1>
          <p class="mb-8 mt-3">
            permissionless alternative to GitHub over nostr
          </p>
        </div>
        <div>
          <div class="card mb-8 bg-base-300">
            <div class="card-body items-center text-center">
              <div class="card-title">
                <h3>
                  pairs with <span class="text-purple-600">n</span>git cli
                </h3>
              </div>
              <div class="prose">
                a command-line tool to <span class="badge">create</span>,
                <span class="badge">list</span> and
                <span class="badge">apply</span> Proposals and patches
                <div class="card-actions mt-3 flex">
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
            alert('install ngit and run `ngit init` your local git repository')}
          class="btn btn-secondary">list your repository</button
        >
      </div>
    </div>
  </div>
  <div class="hero md:basis-1/2">
    <PatchesRecent />
  </div>
</div>
<Container>
  <ReposRecent />
</Container>
