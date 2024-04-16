<script lang="ts">
  import Container from '$lib/components/Container.svelte'
</script>

<Container>
  <div class="prose m-auto mt-8">
    <h2 class=""><span class="text-purple-600">n</span>git</h2>
    <p>a command-line tool to send and review patches via nostr</p>
    <ul>
      <li>
        works seemlessly with <a href="https://gitworkshop.dev"
          >gitworkshop.dev
        </a>
      </li>
      <li>fully compatable with nip34 draft</li>
      <li>
        enables proposals to be managed as branches, similar to GitHub PRs via
        nip34+
      </li>
    </ul>
    <p>ngit and gitworkshop.dev are new, experimental and in an alpha state.</p>

    <div role="alert" class="alert my-3 max-w-2">
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
    <h3>Install</h3>
    <div>
      <p>
        add the following binary to a directory from which it can be run
        globally:
      </p>
      <p>
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.1.2/ngit-x86_64-unknown-linux-gnu.tar.gz"
          class="btn btn-neutral">Linux</a
        >
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.1.2/ngit-x86_64-apple-darwin.tar.gz"
          class="btn btn-neutral">Mac</a
        >
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.1.2/ngit-x86_64-pc-windows-msvc.zip"
          class="btn btn-neutral">Windows</a
        >
        v1.1.2
      </p>

      <p>
        alternatively, if you have cargo installed run<code
          >cargo install ngit</code
        >
      </p>
    </div>
    <h3>Commands</h3>
    <p>run from the your product's git repository:</p>
    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit init</span></span
      >
      signal you are this repo's maintainer accepting proposals via nostr
    </p>

    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit send</span></span
      >
      issue commits as a proposal
    </p>
    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit list</span></span
      >
      list proposals; checkout, apply or donwload selected
    </p>
    <p>and when on a proposal branch:</p>
    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit push</span></span
      >
      send proposal revision
    </p>
    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit pull</span></span
      >
      fetch and apply new proposal commits / revisions linked to branch
    </p>
    <h3>Protocol</h3>
    <p>
      <a href="/about">nip34</a> is draft nip (nostr protocol) for sending git patches
      over nostr, similar to how patches are sent via email which is a model used
      extensively including in very large project such as the linux kernel
    </p>
    <p>
      <a href="/about">nip34+</a> adds backwards compatable features to nip34, primarily
      to enable:
    </p>
    <ul>
      <li>
        patches managed as branches, similar to GitHub PRs
        <ul>
          <li>
            maintain commit ids, pgp signed commits, enabling merge with commits
            pgp signed by the author, amend commits
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
            in the root of your repo that lists the authorised maintainers and desired
            relays.
          </li>
        </ul>
      </li>
    </ul>
    <p>
      if feedback is possive on nip34+ features, they may make it into the nip34
      specification
    </p>

    <p>
      <a class="btn" href="/about">learn more</a>
    </p>
  </div>
</Container>
