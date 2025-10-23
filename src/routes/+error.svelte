<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import { network_status } from '$lib/store.svelte';

	let { data } = $props<{ data: { error?: Error & { status?: number } } }>();

	const error = data?.error || $page.error;
</script>

<ContainerCenterPage>
	<div class="flex flex-col items-center gap-6 text-center">
		<svg
			class="h-24 w-24 opacity-50 {network_status.offline ? 'text-warning' : 'text-error'}"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
			/>
		</svg>

		<div>
			<h1 class="mb-2 text-3xl font-bold">
				{error?.status || 'Error'}
			</h1>
			<p class="text-base-content/70">
				{error?.message || 'Something went wrong'}
			</p>
		</div>

		{#if network_status.offline}
			<div class="alert alert-warning max-w-md">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6 shrink-0 stroke-current"
					fill="none"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
					/>
				</svg>
				<span>You're currently offline. This page may require an internet connection.</span>
			</div>
		{/if}

		<div class="flex gap-4">
			<button class="btn btn-primary" onclick={() => window.location.reload()}>
				{network_status.offline ? 'Try Again' : 'Reload'}
			</button>
			<button class="btn btn-ghost" onclick={() => (window.location.href = `${base}/`)}>
				Go Home
			</button>
		</div>
	</div>
</ContainerCenterPage>
