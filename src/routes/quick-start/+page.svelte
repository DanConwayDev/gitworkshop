<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import InstallNgit from '$lib/components/InstallNgit.svelte';
</script>

<svelte:head>
	<title>GitWorkshop - ngit</title>
</svelte:head>

<Container>
	<div class="prose m-auto mt-8">
		<h2>Quick Start</h2>
		<h4 id="prereq">pre-requesite: install ngit</h4>
		<InstallNgit />
	</div>
</Container>
<div class="bg-base-300">
	<Container>
		<div class="prose m-auto my-4 py-4">
			<h3 id="contributor">Contributor Quick Start</h3>
			<div class="text-sm">
				<div>
					<div class="prose">
						<p>
							pre-requesite: <a href="#prereq">install</a> ngit and git-remote-nostr
						</p>
						<h4>1. find repository</h4>
						<ul>
							<li>
								search <a href="/repos" class="link link-primary">gitworkshop.dev/search</a> for the
								repository
							</li>
							<li>explore PRs and issues</li>
							<li>
								copy the git clone url (or press the green clone button to copy the clone command)
							</li>
						</ul>
						<h4>2. clone repository</h4>
						<ul>
							<li>
								<div>using your prefered git client or with the git command you just copied:</div>
								<div class="not-prose text-sm">
									<code
										><span class="text-yellow-600">git</span> clone nostr://<span
											class="text-purple-600">npub123</span
										>/<span class="text-primary">repo-identifier</span></code
									>
								</div>
							</li>
						</ul>
						<h4>3. submit PR</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>push a branch with the prefix `pr/` for example using git commands:</div>
										<div class="not-prose text-sm">
											<div>
												<code
													><span class="text-yellow-600">git</span> checkout -b pr/great-feature</code
												>
											</div>
											<div>
												<code
													><span class="text-yellow-600">git</span> commit -am "improve the world"</code
												>
											</div>
											<div>
												<code><span class="text-yellow-600">git</span> push -u</code>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>OR for more options such as including a cover letter use ngit:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-purple-600">ngit</span> send</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<h4>4. view PRs</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>
											for open PRs view remote branches with prefix `pr/` for example using git
											command:
										</div>
										<div class="not-prose text-sm">
											<div>
												<code
													><span class="text-yellow-600">git</span> branch -r --list origin/pr/*</code
												>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>OR using ngit:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-purple-600">ngit</span> list</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<h4>5. update PR</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>
											if you are the PR author, or a maintainer you can add commits to a PR:
										</div>
										<div class="not-prose text-sm">
											<div>
												<code
													><span class="text-yellow-600">git</span> commit -am "extra thing"</code
												>
											</div>
										</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-yellow-600">git</span> push</code>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>or revising it:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-yellow-600">git</span> commit -a -amend</code>
											</div>
										</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-yellow-600">git</span> push --force</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Container>
</div>

<div class="">
	<Container>
		<div class="prose m-auto my-4 py-4">
			<h3 id="maintainer">Maintainer Quick Start</h3>
			<div class="text-sm">
				<div>
					<div class="prose">
						<p>
							pre-requesite: <a href="#prereq">install</a> ngit and git-remote-nostr
						</p>
						<h4>1. create a git repo and push to a git server</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>for example using git commands:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-yellow-600">git</span> init</code>
											</div>
											<div>
												<code
													><span class="text-yellow-600">git</span> commit -am "initial commit"</code
												>
											</div>
											<div>
												<code
													><span class="text-green-600"
														>// create repository on git server and the:
													</span></code
												>
											</div>
											<div>
												<code
													><span class="text-yellow-600">git</span> remote add origin https://dm.co/usr/my-repo.git</code
												>
											</div>
											<div>
												<code><span class="text-yellow-600">git</span> push -u origin master</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<h4>2. initialize on nostr</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>initialize:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-purple-600">ngit</span> init </code>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>use the nostr remote to push state to nostr and git server(s):</div>
										<div class="not-prose text-sm">
											<div>
												<code
													><span class="text-yellow-600">git</span> remote set-url origin nostr://<span
														class="text-purple-600">npub123</span
													>/<span class="text-primary">my-repo</span></code
												>
											</div>
										</div>
									</div>
								</li>
								<li>
									ensure all maintainers push to the nostr remote and not git server directly so
									that state on nostr remains in sync
								</li>
							</ul>
						</div>
						<h4>3. view PRs</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>
											for open PRs view remote branches with prefix `pr/` for example using git
											command:
										</div>
										<div class="not-prose text-sm">
											<div>
												<code
													><span class="text-yellow-600">git</span> branch -r --list origin/pr/*</code
												>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>OR using ngit with more options such as applying them directly:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-purple-600">ngit</span> list</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<h4>4. merge / incorporate PRs</h4>
						<div>
							<ul>
								<li>
									<div>
										<div>the PR status will be automatically updated if you merge the branch:</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-yellow-600">git</span> checkout master</code>
											</div>
											<div>
												<code
													><span class="text-yellow-600">git</span> merge pr/great-feature(e8246b2)</code
												>
											</div>
											<div>
												<code><span class="text-yellow-600">git</span> push</code>
											</div>
										</div>
									</div>
								</li>
								<li>
									<div>
										<div>use gitworkshop.dev to make comments or manually set the status.</div>
										<div class="not-prose text-sm">
											<div>
												<code><span class="text-purple-600">ngit</span> list</code>
											</div>
										</div>
									</div>
								</li>
							</ul>
						</div>
						<h4>5. consider turning off PRs and issues elsewhere</h4>
						<div>
							<ul>
								<li>ie. on git server(s) so they are managed solely on nostr.</li>
								<li>
									Note: for github use <code>Repo Settings &gt; Features</code> for issues but turning
									off PRs isn't yet possible.
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Container>
</div>
