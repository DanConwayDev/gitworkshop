<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import {
    ensureProposalSummaries,
    proposal_summaries,
  } from '$lib/stores/Proposals'
  import ReposRecent from '$lib/wrappers/ReposRecent.svelte'

  ensureProposalSummaries(undefined)
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

<Container>
  <div class="mx-auto my-8 grid gap-4 md:grid-cols-2">
    <div class="items">
      <div class="align-center hero-content text-center">
        <div class="max-w-lg">
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
                    pairs with <span class="text-purple-600">n</span>git
                  </h3>
                </div>
                <div class="prose">
                  a command-line tool to <span class="badge">send</span> and
                  <span class="badge">review</span> patches using nostr
                  <div class="card-actions mt-3 flex">
                    <div class="flex-grow">
                      <a href="/ngit" class="btn btn-neutral">install ngit</a>
                    </div>
                    <div class="flex-grow">
                      <a href="/about" class="btn">learn more</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            on:click={() =>
              alert(
                'install ngit and run `ngit init` your local git repository'
              )}
            class="btn btn-secondary">list your repository</button
          >
        </div>
      </div>
    </div>
    <div class="hero">
      <ProposalsList
        title="Recent Proposals"
        proposals_or_issues={$proposal_summaries.summaries}
        show_repo={true}
        loading={$proposal_summaries.loading}
        limit={6}
        allow_more={true}
      />
    </div>
  </div>
</Container>

<Container>
  <ReposRecent />
</Container>
