<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import InstallNgit from '$lib/components/InstallNgit.svelte'
</script>

<svelte:head>
  <title>GitWorkshop - ngit</title>
</svelte:head>

<Container>
  <div class="prose m-auto mt-8">
    <h2 class=""><span class="text-purple-600">n</span>git</h2>
    <p>nostr plugin for git</p>
    <ul>
      <li>
        clone a nostr repository, or add as a remote, by using the url format:<br /><code>nostr://&lt;pub|nip05-address&gt;/&ltidentifier&gt;</code>
      </li>

      <li>remote branches beginning with <code>pr/</code> are open PRs from contributors; <code>ngit&nbsp;list</code> can be used to view all PRs</li>
      <li>to open a PR, push a branch with the prefix <code>pr/</code> or use <code>ngit&nbsp;send</code> for advanced options</li>
      <li>publish a repository to nostr with <code>ngit&nbsp;init</code></li>
    </ul>
    <p>ngit and gitworkshop.dev are new, experimental and in an alpha state.</p>

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
          via an <a
            class="link-secondary"
            href="/r/naddr1qqzxuemfwsqs6amnwvaz7tmwdaejumr0dspzpgqgmmc409hm4xsdd74sf68a2uyf9pwel4g9mfdg8l5244t6x4jdqvzqqqrhnym0k2qj"
            >ngit issue</a
          >, a
          <a
            class="link-secondary"
            href="/r/naddr1qq9kw6t5wahhy6mndphhqqgkwaehxw309aex2mrp0yhxummnw3ezucnpdejqyg9qpr00z4uklw56p4h6kp8gl4ts3y59m874qhd94ql732k40g6kf5psgqqqw7vs2nfsd9"
            >gitworkshop.dev issue</a
          >
          or directly to
          <a
            class="link-primary"
            href="/p/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x"
            >DanConwayDev</a
          > on nostr
        </p>
        <p class="mt-1 text-sm">your feedback makes them better</p>
      </div>
    </div>
    <h3>Install</h3>
    <InstallNgit />
    <p>
      <a class="btn" href="/about">learn more</a>
    </p>
  </div>
</Container>
