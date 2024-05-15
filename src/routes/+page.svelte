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
  <div>
    <div class="m-auto mt-5 max-w-lg text-center">
      <div class="prose">
        <h1 class="mb-2">
          <span class="text-purple-600">git</span><span class="text-white"
            >workshop</span
          ><span class="text-neutral">.dev</span>
        </h1>
        <p class="mb-8 mt-3">
          a decentralized git workflow no nostr for freedom lovers
        </p>
      </div>
    </div>
  </div>
</Container>

<Container>
  <div class="grid gap-4 md:grid-cols-3">
    <div class="card bg-base-300">
      <div class="card-body">
        <div class="card-title">
          <h3>nostr</h3>
        </div>
        <div class="prose">
          An open protocol that is able to create a censorship resistant global
          "social" network once and for all
        </div>
      </div>
    </div>
    <div class="card bg-base-300">
      <div class="card-body">
        <div class="card-title">
          <h3>
            <span class="text-purple-600">n</span>git
          </h3>
        </div>
        <div class="prose">
          a NIP34 compatible command line tool to send and review git patches
          via nostr. <a class="link link-secondary" href="/ngit">more...</a>
        </div>
      </div>
    </div>
    <div class="card bg-base-300">
      <div class="card-body">
        <div class="card-title">
          <h3>
            any <span class="text-yellow-600">git</span> server
          </h3>
        </div>
        <div class="prose">
          to host the authoratitive code. eg. Gitea, Github, Gitlab,
          BitBucket...
        </div>
      </div>
    </div>
  </div>

  <div class="hidden md:block">
    <div class="grid h-5 grid-cols-6 gap-0">
      <div class=""></div>
      <div class="border-b border-l"></div>
      <div class="border-b"></div>
      <div class="border-b border-l"></div>
      <div class="border-b border-r"></div>
    </div>
    <div class="grid h-5 grid-cols-2 gap-0">
      <div class=""></div>
      <div class="border-l"></div>
    </div>
  </div>

  <div class="grid gap-4 md:grid-cols-3">
    <div class=""></div>
    <div class="card bg-base-300">
      <div class="card-body">
        <div class="card-title">
          <h3>
            <span class="text-purple-600">git</span>workshop<span
              class="text-neutral">.dev</span
            >
          </h3>
        </div>
        <div class="prose">
          A web client to collaborate on git repos via nostr, managing issues
          and code proposals
        </div>
      </div>
    </div>
    <div class=""></div>
  </div>
</Container>

<Container>
  <div class="mx-auto my-8 grid gap-4 md:grid-cols-2">
    <div class="items">
      <div class="w-lg prose m-auto my-6">
        <h2>How it works</h2>
        <p>
          Git is a decentralized version control system, yet most freedom tech
          projects use centralized walled gardens on top of git as a social and
          collaboration layer for code changes.
        </p>
        <p>
          ngit and gitworkshop.dev are tools to enable code collaboration over
          nostr. ngit allows contributors to manage the flow to open a proposal,
          maintainers to verify proposals and incorporate them into the project.
          Gitworkshop.dev provides a visual interface to discuss proposals and
          open issues.
        </p>
        <a href="/about" class="btn btn-secondary text-right">learn more</a>
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
