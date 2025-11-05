<script lang="ts">
	import '$lib/store.svelte';
	import '$lib/accounts';

	import Navbar from '$lib/components/Navbar.svelte';
	import PwaUpdateNotification from '$lib/components/PwaUpdateNotification.svelte';
	import '../app.css';
	import Container from '$lib/components/Container.svelte';
	import { resolve } from '$app/paths';
	import store from '$lib/store.svelte';
	import { onMount } from 'svelte';
	let { children } = $props();

	// Build-time version info injected by Vite
	// eslint-disable-next-line no-undef
	const gitCommit = __GIT_COMMIT__;
	// eslint-disable-next-line no-undef
	const commitDate = __COMMIT_DATE__;

	// Apply theme on mount and when it changes
	// Only set data-theme for light mode, remove it for dark (use default)
	onMount(() => {
		if (store.theme === 'light') {
			document.documentElement.setAttribute('data-theme', 'light');
		} else {
			document.documentElement.removeAttribute('data-theme');
		}
	});

	$effect(() => {
		if (store.theme === 'light') {
			document.documentElement.setAttribute('data-theme', 'light');
		} else {
			document.documentElement.removeAttribute('data-theme');
		}
	});

	function toggleTheme() {
		store.stored_theme = store.theme === 'light' ? 'dark' : 'light';
	}
</script>

<div class="gw-page-container">
	<PwaUpdateNotification />
	<Navbar />

	<main class="gw-main">
		{@render children()}
	</main>

	<footer class="bg-base-200 mt-24">
		<Container>
			<div class="my-3 flex">
				<div class="grow"></div>
				<div class="flex items-center">
					<div class="text-neutral-content flex h-10 items-center text-center text-xs">
						<a class="inline" href={resolve('/')}>
							<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="inline h-5 w-5" />
						</a>
						<span class="mt-0.5 ml-2">GitWorkshop.dev</span>
						<span class="ml-2 opacity-50">v{commitDate}+{gitCommit.slice(0, 7)}</span>
					</div>
				</div>
				<div class="grow"></div>

				<button class="swap swap-rotate btn btn-ghost" onclick={toggleTheme}>
					<!-- sun icon (shown when light theme is active) -->
					<svg
						class="h-5 w-5 fill-current {store.theme === 'light' ? '' : 'hidden'}"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
					>
						<path
							d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
						/>
					</svg>

					<!-- moon icon (shown when dark theme is active) -->
					<svg
						class="h-5 w-5 fill-current {store.theme === 'dark' ? '' : 'hidden'}"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
					>
						<path
							d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"
						/>
					</svg>
				</button>
			</div>
		</Container>
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
