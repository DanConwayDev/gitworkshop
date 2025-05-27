<script lang="ts">
	import { onMount } from 'svelte';
	import { NGIT_VERSION } from '$lib/constants';

	let {
		size = 'md',
		download = null
	}: { size?: 'sm' | 'md'; download?: { label: string; href: string } | null } = $props();

	let show_more = $state(false);
	let show_linux_compatibility_notes = $state(false);

	const version = NGIT_VERSION;

	onMount(() => {
		const ua = navigator.userAgent;

		// Map UA → release asset
		const rules: Array<{
			test: RegExp;
			label: string;
			build: (v: string) => string;
		}> = [
			{
				test: /Windows/i,
				label: 'Windows (64-bit)',
				build: (v) =>
					`https://github.com/DanConwayDev/ngit-cli/releases/download/${v}/ngit-${v}-windows-latest.zip`
			},
			{
				test: /(Macintosh|Mac OS X|Mac OS)/i,
				label: 'macOS',
				build: (v) =>
					`https://github.com/DanConwayDev/ngit-cli/releases/download/${v}/ngit-${v}-macos-latest.tar.gz`
			},
			{
				test: /Linux.*(aarch64|arm64)/i,
				label: 'Linux (ARM64)',
				build: (v) =>
					`https://github.com/DanConwayDev/ngit-cli/releases/download/${v}/ngit-${v}-ubuntu-24.04-arm.tar.gz`
			},
			{
				test: /Linux/i,
				label: 'Linux (x86_64)',
				build: (v) =>
					`https://github.com/DanConwayDev/ngit-cli/releases/download/${v}/ngit-${v}-ubuntu-latest.tar.gz`
			}
		];

		for (const rule of rules) {
			if (rule.test.test(ua)) {
				download = { label: rule.label, href: rule.build(version) };
				break;
			}
		}
	});
</script>

<div class="prose max-w-none" class:text-sm={size === 'sm'}>
	{#if download}
		<p>Download, extract binaries and add them to PATH</p>
		<!-- Primary “smart” download -->
		<div class="mb-6 flex flex-wrap items-center gap-4">
			<a href={download.href} class="btn btn-primary" class:btn-sm={size === 'sm'}>
				Download for {download.label}
			</a>
			<small class="opacity-70">{version}</small>
			<button
				class="link"
				onclick={() => {
					show_more = !show_more;
				}}
				>{#if show_more}less{:else}more{/if} options</button
			>
			{#if download.label.includes('Linux')}
				<button
					class="link"
					onclick={() => {
						show_linux_compatibility_notes = !show_linux_compatibility_notes;
					}}>compatibility notes</button
				>{/if}
		</div>
		{#if show_linux_compatibility_notes}<div class="card card-body my-0 bg-base-300">
				<h3 class="mt-0">Linux compatibility notes</h3>
				<ul class="mb-0">
					<li>Requires glibc ≥ 2.31 (Ubuntu 20.04+, Debian 11, Fedora 33+, Arch, etc.)</li>
					<li>
						OpenSSL ≥ 1.1 is dynamically linked. On Alpine or very old distributions install <code
							>openssl1.1-compat</code
						> or use the musl build.
					</li>
					<li>
						Red Hat/CentOS 7 (glibc 2.17) and Debian 10 will fail — use the <em>static-musl</em> build
						or build from source.
					</li>
				</ul>
				<div class="flex flex-wrap items-center gap-4">
					<!-- <a href={download.href} class="disable btn btn-primary" class:btn-sm={size === 'sm'}>
						Download for Linux (static-musl)
					</a> -->
					<button class="btn btn-disabled btn-primary" class:btn-sm={size === 'sm'}>
						Download for Linux (static-musl)
					</button>
					<small class="opacity-70">{version} with bundled dependancies (coming soon)</small>
				</div>
			</div>
		{/if}

		<p></p>
	{/if}

	{#if show_more || !download}
		<h3 class="mb-4 font-semibold">Additional Installation Options</h3>

		<!-- Accordion ---------------------------------------------------------------->
		<div class="space-y-2">
			<!-- 1. Build from source --------------------------------------------------->
			<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
				<input type="radio" name="installation-accordion" checked />
				<div class="collapse-title font-medium">1. Build from Source</div>
				<div class="collapse-content">
					<ul>
						<li>
							<a
								href="https://www.rust-lang.org/tools/install"
								target="_blank"
								class="link-primary"
							>
								Install rust and cargo
							</a>
						</li>
						<li>
							clone
							<a
								href="https://github.com/DanConwayDev/ngit-cli"
								target="_blank"
								class="link-primary"
							>
								this git url
							</a>
						</li>
						<li>checkout the latest release tag ({version})</li>
						<li>
							run <code class="whitespace-nowrap">cargo&nbsp;build&nbsp;--release</code>
						</li>
						<li>
							move the following binaries to your PATH:
							<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
								<div>./target/release/ngit</div>
								<div>./target/release/git-remote-nostr</div>
							</div>
						</li>
					</ul>
				</div>
			</div>

			<!-- 2. Install with Cargo --------------------------------------------------->
			<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
				<input type="radio" name="installation-accordion" />
				<div class="collapse-title font-medium">2. Install with Cargo</div>
				<div class="collapse-content">
					<ul>
						<li>
							<a
								href="https://www.rust-lang.org/tools/install"
								target="_blank"
								class="link-primary"
							>
								Install rust and cargo
							</a>
						</li>
						<li>
							<div class="rounded-md bg-base-400 p-2 font-mono text-sm">cargo install ngit</div>
						</li>
						<li>add <code class="whitespace-nowrap">~/.cargo/bin</code> to your PATH</li>
					</ul>
				</div>
			</div>

			<!-- 3. Install with Nix ----------------------------------------------------->
			<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
				<input type="radio" name="installation-accordion" />
				<div class="collapse-title font-medium">3. Install with Nix</div>
				<div class="collapse-content">
					<ul>
						<li>
							Add ngit as a flake input:
							<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
								{`{ inputs = { ngit.url = "github:DanConwayDev/ngit-cli"; } }`}
							</div>
						</li>
						<li>
							include default packages. eg when using home-manager:
							<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
								{`{ inputs, ... }: {
  home-manager.users.myuser = { pkgs, ... }: {
    home.packages = [
      inputs.ngit.packages."\${pkgs.system}".default
    ];
  }
}`}
							</div>
						</li>
					</ul>
				</div>
			</div>

			<!-- 4. Pre-built binaries --------------------------------------------------->
			<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
				<input type="radio" name="installation-accordion" />
				<div class="collapse-title font-medium">4. Download Compiled Binaries</div>
				<div class="collapse-content">
					<p>Download the pre-built binaries for your platform and add them to your PATH:</p>

					<div class="mt-4 space-y-4">
						<!-- Ubuntu x64 -->
						<div>
							<h5 class="mb-2 mt-0">Ubuntu x64</h5>
							<div class="flex flex-wrap gap-2">
								{#each ['latest', '24.04', '22.04'] as osversion}
									<a
										class="btn btn-neutral btn-sm"
										class:btn-xs={size === 'sm'}
										href={`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-ubuntu-${osversion}.tar.gz`}
									>
										{osversion}
									</a>
								{/each}
							</div>
						</div>

						<!-- Ubuntu arm -->
						<div>
							<h5 class="mb-2 mt-0">Ubuntu arm</h5>
							<div class="flex flex-wrap gap-2">
								{#each ['24.04', '22.04'] as osversion}
									<a
										class="btn btn-neutral btn-sm"
										class:btn-xs={size === 'sm'}
										href={`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-ubuntu-${osversion}-arm.tar.gz`}
									>
										{osversion}
									</a>
								{/each}
							</div>
						</div>

						<!-- macOS -->
						<div>
							<h5 class="mb-2 mt-0">macOS</h5>
							<div class="flex flex-wrap gap-2">
								{#each ['latest', '15', '14', '13'] as osversion}
									<a
										class="btn btn-neutral btn-sm"
										class:btn-xs={size === 'sm'}
										href={`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-macos-${osversion}.tar.gz`}
									>
										{osversion}
									</a>
								{/each}
							</div>
						</div>

						<!-- Windows -->
						<div>
							<h5 class="mb-2 mt-0">Windows</h5>
							<div class="flex flex-wrap gap-2">
								{#each ['latest', '2022', '2019'] as osversion}
									<a
										class="btn btn-neutral btn-sm"
										class:btn-xs={size === 'sm'}
										href={`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-windows-${osversion}.zip`}
									>
										{osversion}
									</a>
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
	<p class="mt-6">
		Verify install - check both binaries are in your PATH and set as executable by running:
	</p>
	<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
		ngit --version<br />
		git-remote-nostr --version
	</div>
</div>
