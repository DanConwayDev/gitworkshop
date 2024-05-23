<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import {
    summary_defaults,
    type RepoEvent,
    type RepoSummary,
  } from '$lib/components/repo/type'
  import { repo_kind } from '$lib/kinds'
  import {
    ensureProposalSummaries,
    proposal_summaries,
  } from '$lib/stores/Proposals'
  import { ensureRepo, repoEventToSummary } from '$lib/stores/repos'
  import { writable, type Writable } from 'svelte/store'

  ensureProposalSummaries(undefined)

  let example_repos: Writable<RepoSummary[]> = writable([])
  const updateRepos = (r: RepoEvent) => {
    example_repos.update((repos) => {
      return [
        ...repos.filter(
          (s) => s.identifier.length > 0 && s.identifier !== r.identifier
        ),
        repoEventToSummary(r) || {
          ...summary_defaults,
        },
      ].sort()
    })
  }

  ensureRepo(
    `${repo_kind}:a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d:ngit`
  ).subscribe(updateRepos)
  ensureRepo(
    `${repo_kind}:a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d:gitworkshop`
  ).subscribe(updateRepos)
</script>

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
          a decentralized git workflow on nostr for freedom lovers
        </p>
      </div>
    </div>
  </div>
</Container>

<Container>
  <div class="m-auto max-w-5xl">
    <div class="grid gap-4 md:grid-cols-3">
      <div class="card bg-base-300">
        <div class="card-body">
          <div class="card-title">
            <h3>nostr</h3>
          </div>
          <div class="prose">
            An open protocol that is able to create a censorship resistant
            global "social" network once and for all
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
            to host the authoritative code. eg. Gitea, Github, Gitlab,
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
  </div>
</Container>

<Container>
  <div class="prose m-auto mb-6 mt-6">
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
      Gitworkshop.dev provides a visual interface to discuss proposals and open
      issues.
    </p>
    <a href="/about" class="btn btn-secondary text-right">learn more</a>
    <h2>Example Repositories</h2>
    <p>These repositories have plenty of issues and proposals to explore</p>
    <div class="not-prose w-[64rem]">
      <ReposSummaryList repos={$example_repos} loading={false} />
    </div>
    <a href="/repos" class="btn btn-primary mt-9">List More Repositories</a>
    <h2>Recent Proposals</h2>
    <div class="not-prose mt-6">
      <ProposalsList
        proposals_or_issues={$proposal_summaries.summaries}
        show_repo={true}
        loading={$proposal_summaries.loading}
        limit={6}
        allow_more={true}
      />
    </div>
  </div>
</Container>
