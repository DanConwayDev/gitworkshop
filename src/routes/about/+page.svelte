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
				href="https://nips.nostr.com/34">NIP-34</a
			>
			and <a class="link" href="https://ngit.dev/grasp">GRASP</a>. gitworkshop.dev,
			<a href={resolve('/ngit')}>ngit</a>
			and
			<a class="link" href="https://ngit.dev/relay">ngit-relay</a>
			are tightly coupled examples maintained by
			<a
				class="link-primary"
				href={resolve(
					'/nprofile1qy88wumn8ghj7mn0wvhxcmmv9uq3vamnwvaz7tmsw4e8qmr9wfjkccte9e3k7mf0qqs2qzx779ted7af5rt04vzw3l2hpzfgtk0a2pw6t2plaz4d2734vng80y96x'
				)}>DanConwayDev</a
			>
			and there are others such as
			<a
				class="link link-primary"
				href={resolve(
					'/npub1qqqqqq2stely3ynsgm5mh2nj3v0nk5gjyl3zqrzh34hxhvx806usxmln03/nostr.4rs.nl/n34'
				)}>n34</a
			>, <a class="link" href="https://budabit.club">budabit</a>,
			<a
				class="link link-primary"
				href={resolve('/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza')}
				>gitplaza</a
			>, and
			<a class="link" href="https://shakespeare.diy">shakespeare</a>.
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

		<p>NIP-34's philosophy can be summed up as:</p>
		<ul>
			<li><strong>let git be git</strong> - don't try and reinvent git</li>
			<li>
				<strong>let nostr be nostr</strong> - leverage the benefits of nostr
			</li>
			<li>
				<strong>let users choose their own workflow</strong> - support PRs, patches, gerrit-style reviews,
				or any other workflow. don't be prescriptive about flow or UX
			</li>
		</ul>

		<h3>The Solution</h3>

		<h4>NIP-34: Git Collaboration over Nostr</h4>

		<p>
			NIP-34 defines how git collaboration can happen over nostr. it supports both patches (with
			diffs embedded in nostr events) and pull requests (with commits stored on git servers and
			referenced in nostr events)
		</p>

		<p>
			for small changes, patches work well - the entire diff is contained in the nostr event. for
			larger changes, PRs are more efficient - commits are pushed to git servers (like GRASP
			servers) and nostr events reference those commits
		</p>

		<p>
			ngit comes with a native git plugin that hides this complexity from users and creates a
			PR-like experience (see below). it presents patches and PRs as a unified interface,
			automatically choosing the most appropriate format based on the size of the change. from the
			user's perspective, they're just proposing changes to a repository
		</p>

		<p>key features enabled by NIP-34:</p>
		<ul>
			<li>
				<strong>flexible workflows</strong> - the protocol contains primitives that can support any workflow
			</li>
			<li>
				<strong>multiple maintainers</strong> - repositories can have multiple maintainers with a smooth
				pathway for transitioning maintainership
			</li>
			<li>
				<strong>repository state in nostr</strong> - the authoritative state (branches, tags, HEAD) is
				stored in nostr events, reducing trust requirements for git servers
			</li>
			<li>
				<strong>distributed hosting</strong> - repository announcements can list multiple git server
				URLs, providing redundancy
			</li>
		</ul>

		<h4>GRASP: Decentralized Git Hosting with Nostr Authorization</h4>

		<p>
			git collaboration over nostr works with any git server - GitHub, GitLab, Gitea, or
			self-hosted. however, early attempts to integrate with existing git servers revealed a
			critical UX problem for maintainers: authorization was split between two systems. maintainers
			had to manage permissions on the git server separately from the nostr-based collaboration
			layer, creating friction and confusion
		</p>

		<p>
			<strong>GRASP</strong> (Git Relays Authorized via Signed-Nostr Proofs) solves this by unifying
			git hosting and nostr authorization, making it easier for maintainers. like Blossom for media files,
			GRASP servers can be run anywhere and host repositories from anyone, with all permissions flowing
			through nostr
		</p>

		<p>
			this enables a truly flexible git workflow. with GRASP, PRs work by pushing commits to
			multiple GRASP servers, then publishing a nostr event that references those commits. the
			maintainer set defined in nostr events controls who can push, eliminating the need for
			separate git server permissions
		</p>

		<p>key features of GRASP:</p>
		<ul>
			<li>
				<strong>unified authorization</strong> - all permissions happen over nostr. no separate git server
				accounts or access control
			</li>
			<li>
				<strong>distributed hosting</strong> - push to multiple GRASP servers for redundancy and censorship
				resistance
			</li>
			<li>
				<strong>flexible hosting models</strong> - servers may offer free quotas, require pre-payment,
				use web-of-trust filtering, or other acceptance criteria
			</li>
			<li>
				<strong>proactive sync</strong> - GRASP servers automatically sync repository data and nostr
				events from other listed servers
			</li>
			<li>
				<strong>dual service</strong> - each GRASP server provides both a nostr relay and a git service.
				all git nostr repository data in one place
			</li>
		</ul>

		<p>
			learn more at <a class="link-primary" href="https://ngit.dev/grasp">ngit.dev/grasp</a> and see
			the reference implementation
			<a class="link-primary" href="https://ngit.dev/relay">ngit-relay</a>
		</p>

		<h4>Seamless Git Integration with ngit</h4>

		<p>
			a git plugin is integrated into ngit, enabling standard git commands to work directly with
			nostr-based repositories. this means you can:
		</p>
		<ul>
			<li>
				<span class="bg-neutral rounded p-2 font-mono"
					><span class="py-5">git&nbsp;clone&nbsp;nostr://npub.../repo</span></span
				> - clone repositories from nostr
			</li>
			<li>
				<span class="bg-neutral rounded p-2 font-mono"><span class="py-5">git&nbsp;push</span></span
				> - maintainers push changes branches and tags
			</li>
			<li>
				<span class="bg-neutral rounded p-2 font-mono"><span class="py-5">git&nbsp;pull</span></span
				> - fetch updates from via GRASP servers
			</li>
			<li>
				<span class="bg-neutral rounded p-2 font-mono"
					><span class="py-5">git&nbsp;push&nbsp;-u&nbsp;origin&nbsp;pr/name-of-change</span></span
				>
				- contributors create PRs with
				<span class="bg-neutral rounded p-2 font-mono"><span class="py-5">pr/</span></span> branch prefix
			</li>
		</ul>

		<p>
			this integration provides a familiar git workflow while leveraging nostr's permissionless,
			decentralized infrastructure for authorization and repository discovery
		</p>

		<h3>Future Improvements</h3>

		<h4>CI/CD Pipelines via Nostr DVMs</h4>

		<p>
			most projects require CI/CD, and while this is often bundled with git hosting solutions, it is
			currently not smoothly integrated into the nostr git ecosystem. Nostr Data Vending Machines
			(DVMs) could provide a marketplace of CI/CD task runners with Cashu for micro payments,
			enabling everything from simple tests to complex deployment workflows. AI agents with NIP60
			Cashu wallets could automatically trigger jobs based on repository activity, creating a
			permissionless and decentralized CI/CD infrastructure. this could also provide a sustainable
			revenue model for GRASP server runners
		</p>

		<details class="collapse-arrow bg-base-200 collapse my-4">
			<summary class="collapse-title text-lg font-medium">read more about CI/CD vision</summary>
			<div class="collapse-content">
				<h4>DVMs for CI/CD</h4>

				<p>
					Nostr Data Vending Machines (DVMs) can provide a marketplace of CI/CD task runners with
					Cashu for micro payments. there are various trust levels in CI/CD tasks:
				</p>

				<ul>
					<li>tasks with no secrets, e.g. tests</li>
					<li>tasks using updatable secrets, e.g. API keys</li>
					<li>unverifiable builds and steps that sign with Android, Nostr, or PGP keys</li>
				</ul>

				<p>
					DVMs allow tasks to be kicked off with specific providers using a Cashu token as payment.
					it might be suitable for some high-compute and easily verifiable tasks to be run by the
					cheapest available providers. medium trust tasks could be run by providers with a good
					reputation, while high trust tasks could be run on self-hosted runners
				</p>

				<p>
					job requests, status, and results all get published to Nostr for display in git-focused
					Nostr clients. jobs could be triggered manually, or self-hosted runners could be
					configured to watch a Nostr repository and kick off jobs using their own runners without
					payment
				</p>

				<h4>CI/CD Watcher Agents</h4>

				<p>
					AI agents empowered with a NIP60 Cashu wallet can run tasks based on activity, such as a
					push to master or a new PR, using the most suitable available DVM runner that meets the
					user's criteria. to keep them running, anyone could top up their NIP60 Cashu wallet;
					otherwise, the watcher turns off when the funds run out. it could be users, maintainers,
					or anyone interested in helping the project who could top up the Watcher Agent's balance
				</p>

				<p>
					part of building a reputation as a CI/CD provider could provide a sustainable revenue
					model for GRASP server runners, creating incentives for many free-at-the-point-of-use
					hosting providers. this, in turn, would allow one-click Nostr repository creation
					workflows, instantly hosted by many different providers
				</p>

				<h4>Progress to Date</h4>

				<p>
					<a
						class="link-primary"
						href={resolve('/npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr')}
						>arjen</a
					>
					has been working on a runner that uses GitHub Actions YAML syntax (using act) for the
					<a class="link-primary" href={resolve('/arjen@swissdash.site/dvm-cicd-runner')}
						>dvm-cicd-runner</a
					>
					and takes Cashu payment. you can see
					<a class="link-primary" href={resolve('/arjen@swissdash.site/dvm-cicd-runner/actions')}
						>example runs on gitworkshop</a
					>. the project is currently dormant but demonstrated the viability of the approach
				</p>

				<p class="text-sm italic">
					note: the actions tab on gitworkshop is currently available on all repositories if you
					turn on experimental mode (under settings in the user menu)
				</p>

				<h4>Easy Web App Deployment</h4>

				<p>
					for those disappointed not to find a 'Nostr' button to import a git repository to Vercel
					menu: take heart, they made it easy. there is a Vercel CLI that can be easily
					<a class="link" href="https://vercel.com/docs/cli#using-in-a-ci/cd-environment"
						>called in CI/CD jobs to kick off deployments</a
					>. not all managed solutions for web app deployment (e.g. Netlify) make it that easy
				</p>
			</div>
		</details>

		<h4>Other Opportunities</h4>

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
