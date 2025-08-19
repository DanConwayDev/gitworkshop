<script lang="ts">
	import '$lib/store.svelte';
	import '$lib/accounts';

	import Navbar from '$lib/components/Navbar.svelte';
	import '../app.css';
	let { children } = $props();
</script>

<div class="gw-page-container">
	<Navbar />

	<main class="gw-main">
		{@render children()}
	</main>

	<footer class="bg-base-200 mt-24">
		<div class="my-3 flex">
			<div class="grow"></div>
			<div class="flex items-center">
				<div class="text-neutral-content flex h-10 items-center text-center text-xs">
					<a class="inline" href="/">
						<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="inline h-5 w-5" />
					</a>
					<span class="mt-0.5 ml-2">GitWorkshop.dev</span>
				</div>
			</div>
			<div class="grow"></div>
		</div>
	</footer>
</div>

<style>
	.gw-page-container {
		display: flex;
		flex-direction: column;
		min-height: 100vh; /* Ensure the container takes at least the full height of the viewport */
	}
	.gw-main {
		flex-grow: 1; /* Allow the main content to grow and fill the available space */
	}
</style>
