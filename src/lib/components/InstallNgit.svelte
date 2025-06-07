<script lang="ts">
	import { onMount } from 'svelte';
	import { NGIT_VERSION } from '$lib/constants';
	import CopyField from './CopyField.svelte';

	let { size = 'md' }: { size?: 'sm' | 'md' } = $props();

	let show_more = $state(false);
	interface Platform {
		name: string;
		compatibility: string;
		url: string;
		primary?: boolean;
	}
	let platforms = $state<Array<Platform>>([]);
	let download = $state<Platform | null>(null);

	let detectedPlatform = $state<string | null>(null);

	const version = NGIT_VERSION;

	onMount(() => {
		// Define all available platforms
		const allPlatforms = [
			{
				name: 'macOS (universal)',
				compatibility: 'macOS 10.13 High Sierra (2017) or newer. Intel + Apple Silicon.',
				url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-universal-apple-darwin.tar.gz`,
				osIdentifiers: [/Mac OS X/, /Macintosh/, /Darwin/]
			},
			{
				name: 'Linux (x86-64, glibc)',
				compatibility:
					'Ubuntu 14.04+, Debian 8+, RHEL/CentOS 7+, Fedora 21+, openSUSE, Arch, etc. Any x86-64 distro with glibc ≥ 2.17. (For Alpine see more options)',
				url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-x86_64-unknown-linux-gnu.2.17.tar.gz`,
				osIdentifiers: [/Linux(?!.*aarch64)/i, /X11(?!.*aarch64)/i]
			},
			{
				name: 'Linux (aarch64, glibc)',
				compatibility:
					'Ubuntu 20.04+, Debian 11+, Amazon Linux 2, AWS Graviton, Raspberry Pi OS 64-bit, etc. Any aarch64/arm64 distro with glibc ≥ 2.17.',
				url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-aarch64-unknown-linux-gnu.2.17.tar.gz`,
				osIdentifiers: [/Linux.*aarch64/i, /Linux.*arm64/i]
			},
			{
				name: 'Linux (musl, static)',
				compatibility:
					'Alpine 3.12+, Distroless and scratch containers, and very old glibc systems. Fully static; no external libraries.',
				url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-x86_64-unknown-linux-musl.tar.gz`,
				osIdentifiers: [/Alpine/i]
			},
			{
				name: 'Windows (x64)',
				compatibility:
					'Windows 7 SP1 / Server 2008 R2 and newer, including Windows 11. Requires the “Universal C Runtime” which is already present on Windows 10+ or via the VC++ 2015-2022 redistributable on older systems. No other DLLs needed.',
				url: `https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-x86_64-pc-windows-msvc.zip`,
				osIdentifiers: [/Windows NT/i, /Win64/i]
			}
		];

		const ua = navigator.userAgent;

		// Convert to our final array format
		platforms = allPlatforms.map((platform) => ({
			name: platform.name,
			compatibility: platform.compatibility,
			url: platform.url
		}));

		// Detect user's platform
		for (const platform of allPlatforms) {
			for (const pattern of platform.osIdentifiers) {
				if (pattern.test(ua)) {
					detectedPlatform = platform.name;

					// Set the smart download
					download = platform;

					platforms = platforms.map((p) => ({ ...p, primary: p.name == platform.name }));

					break;
				}
			}
			if (detectedPlatform) break;
		}
	});
</script>

<div class="prose max-w-none" class:text-sm={size === 'sm'}>
	<p>Installation Command:</p>
	<div class="rounded-md bg-base-400 pb-3 font-mono text-sm text-white">
		<CopyField content={`curl -Ls https://ngit.dev/install.sh | bash`} border_color="none" />
	</div>
	{#if download && download.name === 'Windows (x64)'}
		<p>or one-liner for windows:</p>
		<div class="rounded-md bg-base-400 pb-3 font-mono text-sm text-white">
			<CopyField
				content={`iwr -useb https://yourdomain.com/install.ps1 | iex`}
				border_color="none"
			/>
		</div>
	{/if}

	<p>
		<button
			class="link"
			onclick={() => {
				show_more = !show_more;
			}}
			>{#if show_more}hide{:else}show{/if} other install options</button
		>
	</p>
	{#if show_more}
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
			<!-- 4. Download Binaries For Other Platforms -------------------------------->
			<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
				<input type="radio" name="installation-accordion" />
				<div class="collapse-title font-medium">
					4. Download for Linux (various), macOS and Windows
				</div>
				<div class="collapse-content">
					<p>Download, extract binaries and add them to PATH</p>
					<div class="my-6">
						{#each platforms as platform}
							<div class="mb-6 flex items-center gap-4">
								<a
									href={platform.url}
									class="btn {platform.primary ? 'btn-primary' : 'btn-neutral'} w-44 justify-center"
									class:btn-sm={size === 'sm'}
								>
									{platform.name}
								</a>
								<small class="opacity-70">{platform.compatibility}</small>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
		<p class="mt-6">
			Verify install - check both binaries are in your PATH and set as executable by running:
		</p>
		<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
			ngit --version<br />
			git-remote-nostr --version
		</div>
	{/if}
</div>
