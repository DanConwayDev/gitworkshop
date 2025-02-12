<script lang="ts">
	import '$lib/store.svelte';
	import '$lib/accounts';

	import Navbar from '$lib/components/Navbar.svelte';
	import '../app.css';
	import Container from '$lib/components/Container.svelte';
	let { children } = $props();
</script>

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

<div class="gw-page-container">
	<Navbar />
    
	<main class="gw-main">
		{@render children()}
    </main>

    <footer class="bg-base-200 mt-24">
		<div class="flex my-3">
			<div class="flex-grow"></div>
			<div class="flex items-center">
				<div class="h-10 text-center text-xs text-neutral-content flex items-center">
					<a class="inline" href="/">
						<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-5 w-5 inline" />
					</a>
					<span class="ml-2 mt-0.5">GitWorkshop.dev</span>
				</div>
			</div>
			<div class="flex-grow"></div>
		</div>
    </footer>
</div>