<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import InstallNgit from '$lib/components/InstallNgit.svelte';
</script>

<svelte:head>
	<title>gitworkshop.dev</title>
</svelte:head>

<Container>
	<div>
		<div class="m-auto mt-5 max-w-lg text-center">
			<div class="prose">
				<h1 class="mb-2">
					<span class="text-purple-600">git</span><span class="text-white">workshop</span><span
						class="text-neutral">.dev</span
					>
				</h1>
				<p class="mb-8 mt-3">collaborate on code over nostr</p>
			</div>
		</div>
	</div>
</Container>

<Container>
	<div class="m-auto max-w-5xl">
		<div class="grid gap-4 md:grid-cols-6">
			<div class=""></div>
			<div class="card col-span-2 bg-base-300">
				<div class="card-body">
					<div class="card-title">
						<h3>nostr</h3>
					</div>
					<div class="prose">
						An open protocol that is able to create a censorship resistant global "social" network
						once and for all
					</div>
				</div>
			</div>
			<div class="card col-span-2 bg-base-300">
				<div class="card-body">
					<div class="card-title">
						<h3>
							any <span class="text-yellow-600">git</span> server
						</h3>
					</div>
					<div class="prose">
						used only for syncing data eg. Gitea, Github, Gitlab, self-hosted...
					</div>
				</div>
			</div>
		</div>

		<div class="hidden md:block">
			<div class="grid h-5 grid-cols-6 gap-0">
				<div class=""></div>
				<div class=""></div>
				<div class="border-b border-l"></div>
				<div class="border-b"></div>
				<div class="border-l"></div>
			</div>
			<div class="grid h-5 grid-cols-2 gap-0">
				<div class=""></div>
				<div class="border-l"></div>
			</div>
			<div class="grid h-5 grid-cols-6 gap-0">
				<div class=""></div>
				<div class="border-l border-t"></div>
				<div class="border-t"></div>
				<div class="border-l border-t"></div>
				<div class="border-r border-t"></div>
			</div>
		</div>

		<div class="divider md:hidden"></div>

		<div class="grid gap-4 md:grid-cols-3">
			<div class="card bg-base-300">
				<div class="card-body">
					<div class="card-title">
						<h3>
							<span class="text-purple-600">git</span>workshop<span class="text-neutral">.dev</span>
						</h3>
					</div>
					<div class="prose">A nostr web client to manage and discuss issues and code PRs</div>
				</div>
			</div>
			<div class="card bg-base-300">
				<div class="card-body">
					<div class="card-title">
						<h3>
							<span class="text-yellow-600">git</span>-remote-nostr
						</h3>
					</div>
					<div class="prose">git remote helper (plugin) for seemless nostr integration</div>
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
						a command line tool to manage repos and advanced patch submission&nbsp;/&nbsp;review
					</div>
				</div>
			</div>
		</div>
	</div>
</Container>

<Container>
	<div class="prose m-auto mb-6 mt-6">
		<h2>How it works</h2>
		<p>
			Git is a decentralized version control system, yet most freedom tech projects use centralized
			walled gardens on top of git as a social and collaboration layer for code changes.
		</p>
		<p>
			Gitworkshop.dev, git-remote-nostr and ngit are tools to enable code collaboration over nostr.
			Gitworkshop.dev provides a visual interface to discuss PRs and open issues. git-remote-nostr
			enables PR creation, review and incorporation using standard git tooling. ngit handles
			repository setup and advanced PR submission.
		</p>
		<div class="flex justify-end">
			<a href="/about" class="btn btn-secondary text-right">details</a>
		</div>
	</div></Container
>

<Container>
	<div class="prose m-auto mb-6 mt-6">
		<h2>Quick Start</h2>
		<h3>Install ngit and git-remote-nostr</h3>
		<InstallNgit />
	</div>
	<div class="m-auto max-w-5xl">
		<div class="grid gap-4 md:grid-cols-2">
			<div class="card bg-base-200">
				<div class="card-body">
					<div class="card-title">
						<h3>for the contributor</h3>
					</div>
					<p>
						clone the nostr url and use normal git operations with tool you are used it (eg. your
						IDE)
					</p>
					<div class="text-sm">
						<div>
							<code
								><span class="text-yellow-600">git</span> clone nostr://<span
									class="text-purple-600">npub123</span
								>/<span class="text-primary">repo-identifier</span></code
							>
						</div>
						<div>
							<code
								><span class="text-green-600">// use pr/ branch prefix to create a nostr PR</span
								></code
							>
						</div>
						<div>
							<code><span class="text-yellow-600">git</span> checkout -b pr/great-feature</code>
						</div>
						<div>
							<code><span class="text-yellow-600">git</span> commit -am "improve the world"</code>
						</div>
						<div>
							<code><span class="text-yellow-600">git</span> push -u</code>
						</div>
						<div>
							<code
								><span class="text-green-600">// any branch with pr/ prefix is nostr PR</span></code
							>
						</div>
						<div>
							<code><span class="text-yellow-600">git</span> branch -r --list origin/pr/*</code>
						</div>
					</div>
					<div class="card-actions mt-auto justify-end">
						<a href="/quick-start#contributor" class="btn btn-secondary text-right">full guide</a>
					</div>
				</div>
			</div>
			<div class="card bg-base-200">
				<div class="card-body">
					<div class="card-title">
						<h3>for the maintainer</h3>
					</div>
					<div class="text-sm">
						<div class="not-prose text-sm">
							<div>
								<code
									><span class="text-green-600">// create a git repo and push to a git server</span
									></code
								>
							</div>
							<div>
								<code>mkdir my-repo && cd my-repo</code>
							</div>
							<div>
								<code><span class="text-yellow-600">git</span> init</code>
							</div>
							<div>
								<code><span class="text-yellow-600">git</span> commit -am "initial commit"</code>
							</div>
							<div>
								<code
									><span class="text-green-600">// announce and set origin to nostr url</span></code
								>
							</div>
							<div>
								<div>
									<code><span class="text-purple-600">ngit</span> init </code>
								</div>
								<div>
									<div>
										<code
											><span class="text-green-600"
												>// pushing merged commits updates PR status</span
											></code
										>
									</div>
									<div>
										<code
											><span class="text-yellow-600">git</span> merge origin/pr/great-feature(e8246b2)</code
										>
									</div>
									<div>
										<code><span class="text-yellow-600">git</span> push</code>
									</div>
								</div>
							</div>
						</div>
						<div class="card-actions mt-auto justify-end">
							<a href="/quick-start#maintainer" class="btn btn-secondary text-right">full guide</a>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div></Container
>
