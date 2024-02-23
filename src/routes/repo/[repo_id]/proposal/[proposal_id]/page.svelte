<script lang="ts">
  import { ensureSelectedRepo, selected_repo } from '$lib/stores/repo'
  import {
    ensureProposalFull,
    selected_proposal_full,
    selected_proposal_replies,
  } from '$lib/stores/Proposal'
  import ProposalHeader from '$lib/components/proposals/ProposalHeader.svelte'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Thread from '$lib/wrappers/Thread.svelte'
  import ProposalDetails from '$lib/components/proposals/ProposalDetails.svelte'
  import Container from '$lib/components/Container.svelte'
  import ParsedContent from '$lib/components/events/content/ParsedContent.svelte'
  import Compose from '$lib/wrappers/Compose.svelte'
  import { patch_kind } from '$lib/kinds'
  import Patch from '$lib/components/events/content/Patch.svelte'

  export let data: {
    repo_id: string
    proposal_id: string
  }

  let repo_id = data.repo_id
  let proposal_id = data.proposal_id

  ensureSelectedRepo(repo_id)
  ensureProposalFull(repo_id, proposal_id)

  let repo_error = false
  let proposal_error = false
  $: {
    repo_error = !$selected_repo.loading && $selected_repo.name.length === 0
    proposal_error =
      !$selected_proposal_full.summary.loading &&
      $selected_proposal_full.summary.created_at === 0
  }
</script>

{#if !repo_error}
  <RepoHeader {...$selected_repo} />
{/if}

{#if proposal_error}
  <Container>
    <div role="alert" class="alert alert-error m-auto mt-6 w-full max-w-xs">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        /></svg
      >
      <span
        >Error! cannot find Proposal {repo_error ? 'or repo ' : ''}event</span
      >
    </div>
  </Container>
{:else}
  <ProposalHeader {...$selected_proposal_full.summary} />
  <Container>
    <div class="md:flex">
      <div class="md:mr-2 md:w-2/3">
        <div role="alert" class="alert mt-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="h-6 w-6 shrink-0 stroke-info"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path></svg
          >
          <div>
            <h3 class="prose mb-2 text-sm font-bold">
              view proposal in local git repository
            </h3>
            <p class="prose text-xs">
              <a href="/ngit">install ngit</a>, run
              <span class="rounded bg-neutral p-1 font-mono"
                ><span class="py-3">ngit list</span></span
              > from the local repository and select the proposal title
            </p>
          </div>
        </div>
        <div class="prose my-3">
          {#if $selected_proposal_full.proposal_event && $selected_proposal_full.proposal_event.kind === patch_kind}
            <Patch
              content={$selected_proposal_full.proposal_event.content}
              tags={$selected_proposal_full.proposal_event.tags}
            />
          {:else}
            <ParsedContent
              content={$selected_proposal_full.summary.descritpion}
            />
          {/if}
        </div>
        {#each $selected_proposal_replies as event}
          <Thread {event} replies={[]} />
        {/each}
        <div class="my-3">
          <Compose />
        </div>
      </div>
      <div class="prose ml-2 hidden w-1/3 md:flex">
        <ProposalDetails
          summary={$selected_proposal_full.summary}
          labels={$selected_proposal_full.labels}
          loading={$selected_proposal_full.loading}
        />
      </div>
    </div>
  </Container>
{/if}
