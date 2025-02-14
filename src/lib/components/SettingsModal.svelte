<script lang="ts">
	import { onMount } from 'svelte';
	import { clearLocalRelayDb } from '$lib/dbs/LocalRelayDb';
	import db from '$lib/dbs/LocalDb';
	let { done }: { done: () => void } = $props();

	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') done();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('modal-open') && !target.classList.contains('modal-box'))
				done();
		});
	});

	let clearing = $state(false);

	async function clearDatabases() {
		clearing = true;
		await clearLocalRelayDb();
		await db.delete();
		clearing = false;
		location.reload();
	}
</script>

<dialog class="modal modal-open">
	<div class="modal-box max-w-lg text-wrap">
		<div class="prose mb-5"><h3>Settings</h3></div>
		<div class="mt-2 flex items-center justify-center">
			<button
				class="btn btn-error btn-sm mr-3 normal-case"
				disabled={clearing}
				onclick={() => {
					clearDatabases();
				}}
			>
				{#if clearing}
					Clearing Database and Cache
				{:else}
					Clear Database and Cache
				{/if}
			</button>
			<div class="flex-grow">useful if gitworkshop is misbehaving</div>
		</div>

		<div class="modal-action">
			<button class="btn btn-sm" onclick={done}>Close</button>
		</div>
	</div>
</dialog>
