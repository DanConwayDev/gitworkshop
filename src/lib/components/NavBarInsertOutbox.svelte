<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import store from '$lib/store.svelte';
	import Outbox from './Outbox.svelte';
	import Sidebar from './Sidebar.svelte';

	let outbox_query = liveQueryState(() => {
		return db.outbox.toArray();
	});
	let outbox = $derived([...(outbox_query.current ?? [])]);
	let not_broadly_sent = $derived(outbox.filter((o) => !o.broadly_sent));
	let is_open = $state(false);
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
</script>

{#if outbox.length > 0}
	<div class="relative">
		<button
			class="btn btn-sm mt-1 h-6 px-2 pb-1 pt-1"
			class:btn-primary={is_open}
			class:btn-ghost={!is_open}
			onclick={toggle}
		>
			<div class="indicator">
				{#if not_broadly_sent.length > 0}
					<span class="text-xsm badge indicator-item badge-secondary badge-sm indicator-bottom"
						>{not_broadly_sent.length}0</span
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
		<Sidebar bind:is_open>
			<Outbox />
		</Sidebar>
	</div>
{/if}
