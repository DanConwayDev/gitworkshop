<script lang="ts">
	import { NGIT_VERSION } from '$lib/constants';

	export let size: 'sm' | 'md' = 'md';
	let version = NGIT_VERSION;
</script>

<div class="prose max-w-none" class:text-sm={size === 'sm'}>
	<h3 class="mb-4 font-semibold">Installation Options</h3>

	<div class="space-y-2">
		<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
			<input type="radio" name="installation-accordion" checked />
			<div class="collapse-title font-medium">1. Build from Source</div>
			<div class="collapse-content">
				<ul>
					<li>
						<a href="https://www.rust-lang.org/tools/install" target="_blank" class="link-primary"
							>Install rust and cargo</a
						>
					</li>
					<li>
						clone
						<a href="https://github.com/DanConwayDev/ngit-cli" target="_blank" class="link-primary"
							>this git url</a
						>
					</li>
					<li>checkout the latest release tag ({version})</li>
					<li>
						run
						<code class="whitespace-nowrap">cargo&nbsp;build&nbsp;--release</code>
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

		<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
			<input type="radio" name="installation-accordion" />
			<div class="collapse-title font-medium">2. Install with Cargo</div>
			<div class="collapse-content">
				<ul>
					<li>
						<a href="https://www.rust-lang.org/tools/install" target="_blank" class="link-primary"
							>Install rust and cargo</a
						>
					</li>
					<li>
						<div class="rounded-md bg-base-400 p-2 font-mono text-sm">cargo install ngit</div>
					</li>
					<li>add <code class="whitespace-nowrap">~/.cargo/bin</code> to your PATH</li>
				</ul>
			</div>
		</div>

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

		<div class="collapse collapse-arrow rounded-box border border-base-300 bg-base-200">
			<input type="radio" name="installation-accordion" />
			<div class="collapse-title font-medium">4. Download Compiled Binaries</div>
			<div class="collapse-content">
				<p>Download the pre-built binaries for your platform and add them to your PATH:</p>

				<div class="mt-4 space-y-4">
					<div>
						<h5 class="mb-2 mt-0">Ubuntu x64</h5>
						<div class="flex flex-wrap gap-2">
							{#each ['latest', '24.04', '22.04'] as osversion}
								<a
									href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-ubuntu-{osversion}.tar.gz"
									class="btn btn-neutral btn-sm"
									class:btn-xs={size === 'sm'}
								>
									{osversion}
								</a>
							{/each}
						</div>
					</div>

					<div>
						<h5 class="mb-2 mt-0">Ubuntu arm</h5>
						<div class="flex flex-wrap gap-2">
							{#each ['24.04', '22.04'] as osversion}
								<a
									href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-ubuntu-{osversion}-arm.tar.gz"
									class="btn btn-neutral btn-sm"
									class:btn-xs={size === 'sm'}
								>
									{osversion}
								</a>
							{/each}
						</div>
					</div>

					<div>
						<h5 class="mb-2 mt-0">MacOS</h5>
						<div class="flex flex-wrap gap-2">
							{#each ['latest', '15', '14', '13'] as osversion}
								<a
									href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-macos-{osversion}.tar.gz"
									class="btn btn-neutral btn-sm"
									class:btn-xs={size === 'sm'}
								>
									{osversion}
								</a>
							{/each}
						</div>
					</div>

					<div>
						<h5 class="mb-2 mt-0">Windows</h5>
						<div class="flex flex-wrap gap-2">
							{#each ['latest', '2022', '2019'] as osversion}
								<a
									href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-windows-{osversion}.zip"
									class="btn btn-neutral btn-sm"
									class:btn-xs={size === 'sm'}
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

	<p>After installation, run the following commands to ensure both binaries are in your PATH:</p>
	<div class="rounded-md bg-base-400 p-2 font-mono text-sm">
		ngit<br />
		git-remote-nostr
	</div>
</div>
