<script lang="ts">
	import { onMount } from 'svelte';

	let showUpdate = $state(false);
	let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined = $state(undefined);

	onMount(async () => {
		// Only register service worker in production
		if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
			try {
				// @ts-expect-error - virtual module from @vite-pwa/sveltekit
				const pwaModule = await import('virtual:pwa-register');
				const { registerSW } = pwaModule as {
					registerSW: (options: {
						immediate?: boolean;
						onNeedRefresh?: () => void;
						onOfflineReady?: () => void;
					}) => (reloadPage?: boolean) => Promise<void>;
				};

				updateSW = registerSW({
					immediate: true,
					onNeedRefresh() {
						showUpdate = true;
					},
					onOfflineReady() {
						console.log('PWA: App ready to work offline');
					}
				});
			} catch (error) {
				// PWA module not available (dev mode or build issue)
				console.log('PWA registration skipped:', error);
			}
		}
	});

	function handleUpdate() {
		if (updateSW) {
			updateSW(true);
		}
	}

	function dismiss() {
		showUpdate = false;
	}
</script>

{#if showUpdate}
	<div class="toast toast-top toast-center z-50">
		<div class="alert alert-info shadow-lg">
			<div>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					class="h-6 w-6 shrink-0 stroke-current"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
				<div>
					<h3 class="font-bold">New version available!</h3>
					<div class="text-xs">Click update to get the latest features</div>
				</div>
			</div>
			<div class="flex gap-2">
				<button class="btn btn-sm" onclick={dismiss}>Later</button>
				<button class="btn btn-primary btn-sm" onclick={handleUpdate}>Update</button>
			</div>
		</div>
	</div>
{/if}
