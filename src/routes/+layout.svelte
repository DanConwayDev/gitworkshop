<script lang="ts">
	import '$lib/store.svelte';
	import '$lib/accounts';

	import Navbar from '$lib/components/Navbar.svelte';
	import '../app.css';
	import Container from '$lib/components/Container.svelte';
	let { children } = $props();
</script>

<div class="gw-page-container">
	<Navbar />

	<main class="gw-main">
		{@render children()}
	</main>

	<footer class="mt-24 bg-base-200">
		<div class="my-3 flex">
			<div class="flex-grow"></div>
			<div class="flex items-center">
				<div class="flex h-10 items-center text-center text-xs text-neutral-content">
					<a class="inline" href="/">
						<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="inline h-5 w-5" />
					</a>
					<span class="ml-2 mt-0.5">GitWorkshop.dev</span>
				</div>
			</div>
			<div class="flex-grow"></div>
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
