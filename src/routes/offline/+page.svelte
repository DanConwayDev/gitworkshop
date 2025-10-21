<script lang="ts">
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
</script>

<ContainerCenterPage>
	<div class="flex flex-col items-center gap-6 text-center">
		<svg
			class="h-24 w-24 text-base-content opacity-50"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
			/>
		</svg>

		<div>
			<h1 class="mb-2 text-3xl font-bold">You're Offline</h1>
			<p class="text-base-content/70">
				GitWorkshop.dev requires an internet connection to sync with Nostr relays.
			</p>
		</div>

		<div class="alert alert-info max-w-md">
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
			<span>Your cached repositories and data are still available for viewing.</span>
		</div>

		<button class="btn btn-primary" onclick={() => window.location.reload()}>
			Try Again
		</button>
	</div>
</ContainerCenterPage>
