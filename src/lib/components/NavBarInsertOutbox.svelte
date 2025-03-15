<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import Outbox from './Outbox.svelte';

	let outbox_query = liveQueryState(() => {
		return db.outbox.toArray();
	});
	let outbox = $derived([...(outbox_query.current ?? [])]);
	let not_broadly_sent = $derived(outbox.filter((o) => !o.broadly_sent));
	let is_open = $state(false);
</script>

{#if outbox.length > 0}
	<div class="relative">
		<button
			class="btn btn-ghost btn-sm"
			onclick={() => {
				is_open = !is_open;
			}}
		>
			<div class="indicator">
				{#if not_broadly_sent.length > 0}
					<span class="text-xsm badge indicator-item badge-secondary badge-sm indicator-bottom"
						>{not_broadly_sent.length}</span
					>
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48"
					><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"
						><path stroke-linecap="round" d="M4 30L9 6h30l5 24" /><path
							fill="currentColor"
							d="M4 30h10.91l1.817 6h14.546l1.818-6H44v13H4z"
						/><path stroke-linecap="round" d="m18 20l6-6l6 6m-6 6V14" /></g
					></svg
				>
			</div>
		</button>
		{#if is_open}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-10"
				onclick={() => {
					is_open = !is_open;
				}}
			></div>

			<div
				class="min-w-xl absolute right-0 top-full z-20 mt-2 max-w-2xl overflow-y-auto rounded-lg bg-base-400 p-4 shadow-lg"
				style="height: calc(100vh - 80px); width: calc(70vw - 300px)"
			>
				<Outbox />
			</div>
		{/if}
	</div>
{/if}
