<script lang="ts">
	import { resolve } from '$app/paths';
	import Container from '$lib/components/Container.svelte';
</script>

<svelte:head>
	<title>GitWorkshop - About</title>
</svelte:head>

<!--
  Proposed style:
  o headers and titles are capitalized, but with no ending period.
  o sentences are not capitalized, but end with period when followed
    by another sentence (period as separator, not terminator)
  o bullet points are not capitalized, use period as terminator as above
  o identifiers MAY use html code style to avoid confusion with
    period when ending a sentence.
-->

<Container>
	<div class="prose m-auto mt-8">
		<h2 class="">About</h2>
		<p>
			There is an ecosystem of tools to enable git code collaboration over nostr using <a
				class="link"
				href="https://nips.nostr.com/34">nip34</a
			>. gitworkshop.dev, <a href={resolve('/ngit')}>ngit</a> and git-remote-nostr are
			tightly-coupled examples maintained by
			<a
				class="link-primary"
				href={resolve(
					'/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x'
				)}>DanConwayDev</a
			>
			and there are others such as
			<a
				class="link link-primary"
				href={resolve('/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza')}
				>gitplaza</a
			>, <a class="link link-primary" href={resolve('/fiatjaf.com/gitstr')}>gitstr</a> and
			<a class="link link-primary" href={resolve('/fiatjaf.com/song')}>song</a>.
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
					via an <a
						class="link-secondary"
						href={resolve(
							'/r/naddr1qqzxuemfwsqs6amnwvaz7tmwdaejumr0dspzpgqgmmc409hm4xsdd74sf68a2uyf9pwel4g9mfdg8l5244t6x4jdqvzqqqrhnym0k2qj'
						)}>ngit issue</a
					>, a
					<a
						class="link-secondary"
						href={resolve(
							'/r/naddr1qq9kw6t5wahhy6mndphhqqgkwaehxw309aex2mrp0yhxummnw3ezucnpdejqyg9qpr00z4uklw56p4h6kp8gl4ts3y59m874qhd94ql732k40g6kf5psgqqqw7vs2nfsd9'
						)}>gitworkshop.dev issue</a
					>
					or directly to
					<a
						class="link-primary"
						href={resolve(
							'/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x'
						)}>DanConwayDev</a
					> on nostr
				</p>
				<p class="mt-1 text-sm">your feedback makes them better</p>
			</div>
		</div>

		<h3>The Need</h3>

		<p>
			git is a decentralized version control system, yet most freedom tech projects use centralized
			walled gardens on top of git as a social and collaboration layer for code changes
		</p>
		<p>
			the most popular is Microsoft's GitHub, and like most big tech companies, it has a history of
			banning accounts (and repositories) without warning. this creates a real risk of disruption
			for important projects like bitcoin-core
		</p>

		<h3>The Opportunity</h3>

		<p>
			whilst alternatives do exist, nearly all of them involve moving to another walled garden,
			either controlled by a different centralized guardian, or self-hosted which is less suitable
			for an anarchic project
		</p>
		<p>
			some projects use patches-over-email: an alternative and decentralized approach that pre-dates
			GitHub. despite its antiquated tooling, it has a very smooth and effective workflow for those
			that use it regularly and has proven to scale to very large projects like the linux kernel
		</p>

		<p>
			ultimately, GitHub remains by far the most popular choice for freedom tech projects. the
			accessible UX, convenience, inter-connected tooling and network effect are just a few of the
			reasons
		</p>

		<p>
			nostr is the ideal permissionless, decentralized, and censorship resistant social layer for
			the anarchic FOSS code collaboration use case
		</p>

		<p>
			there is an opportunity to build modern tooling that competes from a UX perspective and has
			the additional benefit of integrating into a wider social ecosystem
		</p>

		<h3>The Philosophy</h3>

		<p>ngit and gitworkshop.dev's philosophy can be summed up as:</p>
		<ul>
			<li><strong>let git be git</strong> - don't try and reinvent git</li>
			<li>
				<strong>let nostr be nostr</strong> - leverage the benefits of nostr
			</li>
			<li>
				<strong>learn from the success of others</strong> - eg. the PR model has proved to be very popular.
				how can we enable similar experiences with patches?
			</li>
		</ul>

		<p>
			patch-over-email, with its proven scalability, lays the foundation for providing this social
			layer without having to re-invent the complexities of creating an efficient alternative to git
			server over nostr, or use specialized relays
		</p>

		<h3>The Solution</h3>

		<p>
			<strong>nip34</strong> is a nostr protocol for sending git patches over nostr, similar to how patches
			are sent via email using `git format-patch` and `git send-email`. the patches-over-email model
			has proven to be a robust workflow that is used extensively, including in very large projects such
			as the linux kernel
		</p>

		<p>
			git-remote-nostr, ngit and gitworkshop.dev implements optional features of nip34, which
			enable:
		</p>
		<ul>
			<li>
				patches to be managed as branches, similar to GitHub PRs
				<ul>
					<li>
						Open and Draft PRs become branches with the prefix <span
							class="bg-neutral rounded p-2 font-mono"><span class="py-5">pr/</span></span
						>
					</li>
					<li>
						the PR author and maintainers can add new commits can using <span
							class="bg-neutral rounded p-2 font-mono"><span class="py-5">git&nbsp;push</span></span
						>
					</li>
					<li>
						commits can be rebased, updated or replaced using <span
							class="bg-neutral rounded p-2 font-mono"
							><span class="py-5">git&nbsp;push&nbsp;--force</span></span
						>
						or
						<span class="bg-neutral rounded p-2 font-mono"
							><span class="py-5">ngit&nbsp;send&nbsp;--in-reply-to&nbsp;nevent123...</span></span
						>
					</li>
					<li>
						with ngit - author pgp signatures and therefore the original commit&nbsp;ids can be
						retained
					</li>
					<li>
						features can be 'merged' using a 'merge commit' so that a series of feature commits can
						remain distinct rather than each applied to the main branch directly
					</li>
				</ul>
			</li>
			<li>
				support multiple maintainers for a repository and a pathway to smoothly transition
				maintainership when a maintainer moves on
			</li>
			<li>
				the repository state is stored in nostr events, reducing the required trust for git servers
			</li>
		</ul>

		<h3>FAQs</h3>

		<h4>You're not replacing GitHub, you're still using GitHub as a git server</h4>
		<p>
			it is trivial to switch git servers as they all operate with the exact same protocol. changing
			the social layer requires a social and UX shift which can be challenging, disruptive and
			timeconsuming
		</p>

		<h4>Are you trying to replicate / replace Github?</h4>

		<p>
			no. GitHub is a very large product with a lot of features which don't meet the goal of freedom
			tech code collaboration
		</p>
		<p>we are specifically looking to address the needs of anarchic FOSS freedom tech products</p>

		<h3>Enhancements</h3>

		<p>got ideas? please share them and lets explore as a community</p>
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
						href={resolve(
							'/r/naddr1qqzxuemfwsqs6amnwvaz7tmwdaejumr0dspzpgqgmmc409hm4xsdd74sf68a2uyf9pwel4g9mfdg8l5244t6x4jdqvzqqqrhnym0k2qj'
						)}>ngit issue</a
					>, a
					<a
						class="link-secondary"
						href={resolve(
							'/r/naddr1qq9kw6t5wahhy6mndphhqqgkwaehxw309aex2mrp0yhxummnw3ezucnpdejqyg9qpr00z4uklw56p4h6kp8gl4ts3y59m874qhd94ql732k40g6kf5psgqqqw7vs2nfsd9'
						)}>gitworkshop.dev issue</a
					>
					or directly to
					<a
						class="link-primary"
						href={resolve(
							'/p/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x'
						)}>DanConwayDev</a
					> on nostr
				</p>
				<p class="mt-1 text-sm">your feedback makes them better</p>
			</div>
		</div>
	</div>
</Container>
