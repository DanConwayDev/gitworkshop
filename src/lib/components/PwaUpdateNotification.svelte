<script lang="ts">
	import { onMount } from 'svelte';

	let showUpdate = $state(false);
	let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined = $state(undefined);
	// Set to true only when the user explicitly clicks "Update", so the controllerchange
	// listener knows whether the SW activation was user-initiated or unexpected.
	let userInitiatedUpdate = false;

	onMount(async () => {
		// Only register service worker in production
		if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
			// CRITICAL: Listen for controller changes. When a new SW takes over (via clientsClaim),
			// the current page's HTML still references old hashed JS filenames. Any subsequent
			// navigation or dynamic import will fail with MIME type errors (server returns index.html
			// for missing old JS files). Force a full reload immediately to get fresh HTML with
			// correct asset hashes before SvelteKit tries to load any stale chunks.
			//
			// If the user clicked "Update", updateSW(true) already triggers a reload — this listener
			// is a safety net for the case where the SW activates unexpectedly (e.g. all other tabs
			// were closed, causing the old SW to be discarded and the new one to activate without
			// skipWaiting being called). In that scenario we must reload to avoid MIME errors.
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (userInitiatedUpdate) {
					// User clicked Update — updateSW(true) handles the reload, nothing to do here.
					console.log('PWA: User-initiated SW update, reload handled by updateSW.');
					return;
				}
				// Unexpected activation (e.g. last tab closed elsewhere). The page's asset hashes
				// are now stale — reload immediately before any navigation breaks things.
				console.log('PWA: Unexpected SW controller change, reloading for fresh assets...');
				window.location.reload();
			});

			try {
				// @ts-expect-error - virtual module from @vite-pwa/sveltekit
				const pwaModule = await import('virtual:pwa-register');
				const { registerSW } = pwaModule as {
					registerSW: (options: {
						immediate?: boolean;
						onNeedRefresh?: () => void;
						onOfflineReady?: () => void;
						onRegisteredSW?: (
							swScriptUrl: string,
							registration?: ServiceWorkerRegistration
						) => void;
					}) => (reloadPage?: boolean) => Promise<void>;
				};

				updateSW = registerSW({
					immediate: true,
					onNeedRefresh() {
						// Only show update prompt if there's actually a waiting service worker
						// This prevents showing the prompt on fresh page loads where the new SW is already active
						navigator.serviceWorker.getRegistration().then((registration) => {
							if (registration && registration.waiting) {
								console.log('PWA: New version available, showing update prompt');
								showUpdate = true;
							} else {
								console.log('PWA: New SW already active, no prompt needed');
							}
						});
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

	async function handleUpdate() {
		if (updateSW) {
			try {
				console.log('PWA: Starting update process...');
				userInitiatedUpdate = true;
				// Trigger skipWaiting on the waiting SW. This causes it to activate,
				// which fires the 'controllerchange' event above (ignored via flag),
				// then reloads the page with fresh HTML and asset hashes.
				// cleanupOutdatedCaches:true in workbox config handles removing old caches.
				// Do NOT manually clear caches here — that would delete the new SW's precache
				// before the reload, forcing everything to be re-fetched from the network.
				await updateSW(true);
			} catch (error) {
				console.error('PWA update failed:', error);
				userInitiatedUpdate = false;
				// Fallback: reload anyway so the user isn't stuck
				window.location.reload();
			}
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
