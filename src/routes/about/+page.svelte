<script lang="ts">
  import Container from '$lib/components/Container.svelte'
</script>

<Container>
  <div class="prose m-auto mt-8">
    <h2 class="">About</h2>
    <p>
      gitworkshop.dev and <a href="/ngit">ngit</a> are tools to enable code
      collaboration over nostr created and maintained by
      <a
        class="link-primary"
        href="https://njump.me/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x"
        >DanConwayDev</a
      >
    </p>
    <p>
      they implement the nip34 draft, which ports the <a
        href="https://git-send-email.io/"
        target="_blank">git-email-patch model</a
      > to nostr, and also have backwards compatible enhancements (nip34+ for shorthand)
      eg. to optionally enable experiences similar to github PRs
    </p>

    <p>
      gitworkshop.dev aims to support all things git on nostr, such as the yet
      to be released and NostrNest and gnostr. ngit is more opinionated focusing
      on nip34+
    </p>

    <div role="alert" class="alert my-3">
      <!-- licence MIT https://icon-sets.iconify.design/ph/hands-praying-fill/ -->
      <svg
        class="h-5 w-5 shrink-0 stroke-current"
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 256 256"
        ><path
          fill="currentColor"
          d="m235.32 180l-36.24-36.25l-36.46-120.29A21.76 21.76 0 0 0 128 12.93a21.76 21.76 0 0 0-34.62 10.53l-36.46 120.3L20.68 180a16 16 0 0 0 0 22.62l32.69 32.69a16 16 0 0 0 22.63 0L124.28 187a40.68 40.68 0 0 0 3.72-4.29a40.68 40.68 0 0 0 3.72 4.29L180 235.32a16 16 0 0 0 22.63 0l32.69-32.69a16 16 0 0 0 0-22.63M120 158.75a23.85 23.85 0 0 1-7 17L88.68 200L56 167.32l13.65-13.66a8 8 0 0 0 2-3.34l37-122.22A5.78 5.78 0 0 1 120 29.78Zm47.44 41.38L143 175.72a23.85 23.85 0 0 1-7-17v-129a5.78 5.78 0 0 1 11.31-1.68l37 122.22a8 8 0 0 0 2 3.34l14.49 14.49Z"
        /></svg
      >
      <div>
        <h4 class="my-1 font-bold">please provide feedback</h4>
        <p class="mb-0 text-sm">
          via an <a class="link-secondary" href="/repo/ngit">ngit issue</a>, a
          <a class="link-secondary" href="/repo/gitworkshop"
            >gitworkshop.dev issue</a
          >
          or directly to
          <a
            class="link-primary"
            href="https://njump.me/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x"
            >DanConwayDev</a
          > on nostr
        </p>
        <p class="mt-1 text-sm">
          the tools are in alpha and your feedback makes them better
        </p>
      </div>
    </div>

    <p>
      should we focus on improving the PR-like experiences or remove them in
      favor of traditional patch-model patch application? please let use know!
    </p>
    <h3>The Need</h3>

    <p>
      git is a decentralized version control system, yet most freedom tech
      projects use centralized walled gardens on top of git as a social and
      collaboration layer for code changes
    </p>

    <p>
      by far the most popular, Microsoft's GitHub, has a history of banning
      accounts and repositories without warning and this creates a real risk of
      disruption for important projects like bitcoin-core
    </p>

    <h3>The Opportunity</h3>

    <p>
      whilst alternatives do exist, nearly all of them involve moving to an
      another walled garden, either controlled by a different centralized
      guardian, or self-hosted which is less suitable for a anarchic project
    </p>
    <p>
      some projects use patches-over-email: an alternative and decentralized
      approach that pre-dates GitHub. despite its antiquated tooling, it has a
      very smooth and effective workflow for those that use it regularly and has
      proven to scale to very large projects like the linux kernal.
    </p>

    <p>
      ultimately, GitHub remains by far the most popular choice for freedom tech
      projects. The accessible UX, convenience, inter-connected tooling and
      network effect are just a few of the reasons
    </p>

    <p>
      nostr is the ideal permissionless, decentralized and censorship resistant
      social layer for the anarchic FOSS code collaboration use case
    </p>

    <p>
      there is an opportunity to build modern tooling that compete from a UX
      perspective and have the additional benefit of integrating into a wider
      social ecosystem
    </p>

    <h3>The Philosophy</h3>

    <p>
      there is innovation happening with git and nostr in a few places and
      gitworkshop.dev aims to work with different approaches
    </p>

    <p>ngit is more opinionated and its philosophy can be summed up as:</p>
    <ul>
      <li><strong>let git be git</strong> - don't try and reinvent git</li>
      <li>
        <strong>let nostr be nostr</strong> - leverage the benefits of nostr
      </li>
      <li>
        <strong>learn from the success of others</strong> - eg. the PR model has
        proved to be very popular. how can we enable similar experiences with patches?
      </li>
    </ul>

    <p>
      patch-over-email, with its proven scalability, lays the foundation for
      providing this social layer without having to re-invent the complexities
      of creating an efficient alternative to git server over nostr, or use
      specialized relays
    </p>

    <h3>The Protocol</h3>

    <p>
      <strong>nip34</strong> is draft nip (nostr protocol) for sending git patches
      over nostr, similar to how patches are sent via email using `git format-patch`
      and `git send-email`. The patches-over-email model has proven to be a robust
      workflow that is used extensively; including in very large project such as
      the linux kernel
    </p>

    <p>
      ngit and gitworkshop.dev are experimenting with some additional, backwards
      compatible features (<strong>nip34+</strong> for shorthand), some of which
      may make it into the nip34 specification:
    </p>

    <ul>
      <li>
        patches optionally managed as branches, similar to GitHub PRs
        <ul>
          <li>
            amendments to a proposal can be made by pushing a commit using <span
              class="rounded bg-neutral p-2 font-mono"
              ><span class="py-5">ngit&nbsp;push</span></span
            >
            rather than issuing a complete revision, which modifies the original
            commits (still possible with
            <span class="rounded bg-neutral p-2 font-mono"
              ><span class="py-5">ngit&nbsp;push&nbsp;--force</span></span
            >
            or
            <span class="rounded bg-neutral p-2 font-mono"
              ><span class="py-5"
                >ngit&nbsp;send&nbsp;--in-reply-to&nbsp;nevent123...</span
              ></span
            >)
          </li>
          <li>
            proposal can be checked out as a branch which reflects the repo
            state when the proposal was generated with pgp signatures intact
            <ul>
              <li>
                there is less friction for reviewers with this model as they
                don't have to deal with resolving conflicts as patches are
                applied to the tip of the main branch. whereas maintainers, who
                might be considering accepting the proposal right away, may find
                it preferable to resolves conflicts as part of their review
              </li>
            </ul>
          </li>
          <li>author pgp signatures and original commit_ids can be retained</li>
          <li>
            features can be 'merged' using a 'merge commit' so that a series of
            feature commits can remain distinct rather than each applied to the
            main branch directly.
          </li>
        </ul>
      </li>
      <li>
        multiple maintainers for a repository and a pathway to smoothly
        transition maintainership when a maintainer moves on
      </li>
      <li>
        ensure that user who have already cloned the repository dont get scammed
        by someone else issuing a repository event, pretending to be the
        maintainer, and directing users to a malicious git server
        <ul>
          <li>
            <span class="rounded bg-neutral p-2 font-mono"
              ><span class="py-5">ngit init</span></span
            >
            creates an optional
            <span class="bg-base-200 p-2 font-mono">maintainers.yaml</span> file
            in the root of your repo that lists the authorized maintainers and
            desired relays
            <ul>
              <li>
                a fallback is used to prevent contributors from needing to know
                the event id if a maintainer is not ready to add a nostr
                specific file to the repository. ngit tags the earliest unique
                commit id in the repo event. ngit defaults to uses the most
                recent repo event it finds with this tag. it also tags all
                proposals with this id and when listing patches, also includes
                patches sent to other repo events with this id as it is clearly
                intended for the same repo.
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>

    <h3>FAQs</h3>

    <h4>
      Your not replacing GitHub, your still using it GitHub as a git server.
    </h4>
    <p>
      it is trivial to switch git servers as they all operate the exact same
      protocol. changing the social layer requires a social and UX shift which
      can be challenging, disruptive and timeconsuming.
    </p>

    <h4>are you trying to replicate / replace Github?</h4>

    <p>
      no. GitHub is a very large product with a lot of features which don't meet
      the goal of freedom tech code collaboration.
    </p>
    <p>
      we are specifically looking to address the needs of anarchic FOSS freedom
      tech products
    </p>

    <h3>Enhancements</h3>

    <p>
      got ideas? please share them and lets explore as a community. here's three
      to get you started:
    </p>
    <ul>
      <li>DVM to run CI pipelines? <i>yes please</i></li>
      <li>
        services to enable merge directly from nostr events. <i>hello!</i>
      </li>
      <li>
        repo event showing authoritive tip of main branch and referencing
        multiple git_server mirros? <i>Hell yeah!</i>
      </li>
    </ul>

    <div role="alert" class="alert my-3">
      <!-- licence MIT https://icon-sets.iconify.design/ph/hands-praying-fill/ -->
      <svg
        class="h-5 w-5 shrink-0 stroke-current"
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 256 256"
        ><path
          fill="currentColor"
          d="m235.32 180l-36.24-36.25l-36.46-120.29A21.76 21.76 0 0 0 128 12.93a21.76 21.76 0 0 0-34.62 10.53l-36.46 120.3L20.68 180a16 16 0 0 0 0 22.62l32.69 32.69a16 16 0 0 0 22.63 0L124.28 187a40.68 40.68 0 0 0 3.72-4.29a40.68 40.68 0 0 0 3.72 4.29L180 235.32a16 16 0 0 0 22.63 0l32.69-32.69a16 16 0 0 0 0-22.63M120 158.75a23.85 23.85 0 0 1-7 17L88.68 200L56 167.32l13.65-13.66a8 8 0 0 0 2-3.34l37-122.22A5.78 5.78 0 0 1 120 29.78Zm47.44 41.38L143 175.72a23.85 23.85 0 0 1-7-17v-129a5.78 5.78 0 0 1 11.31-1.68l37 122.22a8 8 0 0 0 2 3.34l14.49 14.49Z"
        /></svg
      >
      <div>
        <h4 class="my-1 font-bold">please provide feedback</h4>
        <p class="mb-0 text-sm">
          via an <a class="link-secondary" href="/repo/ngit">ngit issue</a>, a
          <a class="link-secondary" href="/repo/gitworkshop"
            >gitworkshop.dev issue</a
          >
          or directly to
          <a
            class="link-primary"
            href="https://njump.me/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x"
            >DanConwayDev</a
          > on nostr
        </p>
        <p class="mt-1 text-sm">
          the tools are in alpha and your feedback makes them better
        </p>
      </div>
    </div>
  </div>
</Container>
