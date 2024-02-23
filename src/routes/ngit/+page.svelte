<script lang="ts">
  import Container from '$lib/components/Container.svelte'
</script>

<Container>
  <div class="prose m-auto mt-8">
    <h2 class=""><span class="text-purple-600">n</span>git</h2>
    <p>
      a command-line tool for managing git repositories change proposals via
      nostr
    </p>
    <p>
      works seemlessly with <a href="https://gitworkshop.dev">gitworkshop.dev</a
      >
    </p>

    <h3>Install</h3>
    <p>
      until the release of v1.0.0 you will need to clone ngit-cli `main` branch
      and build from source
    </p>
    <div class="line-through">
      <p>
        add the following binary to a directory from which it can be run
        globally:
      </p>
      <p>
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.0.0/ngit-x86_64-unknown-linux-gnu.tar.gz"
          class="btn btn-neutral">Linux</a
        >
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.0.0/ngit-x86_64-apple-darwin.tar.gz"
          class="btn btn-neutral">Mac</a
        >
        <a
          href="https://github.com/DanConwayDev/ngit-cli/releases/download/v1.0.0/ngit-x86_64-pc-windows-msvc.zip"
          class="btn btn-neutral">Windows</a
        > TODO: issue v1.0.0 and activate these links
      </p>

      <p>
        alternatively, if you have cargo installed run<code
          >cargo install ngit</code
        >
      </p>
    </div>
    <h3>Commands</h3>
    <p>run from the directory of the git repository:</p>
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
    <h3>Learn More</h3>

    <p>
      <span class="rounded bg-neutral p-2 font-mono"
        ><span class="py-5">ngit init</span></span
      >
      also creates an optional
      <span class="bg-base-200 p-2 font-mono">maintainers.yaml</span> file in the
      root of your repo that lists maintainers and relays. If commited it will make
      it smoother for contributors to find your repository event and also makes any
      future transfer of repository ownership easier.
    </p>
  </div>
</Container>
