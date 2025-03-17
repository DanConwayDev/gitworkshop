<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import store from '$lib/store.svelte';
	import { onMount } from 'svelte';
	import Outbox from './Outbox.svelte';
	import { slide } from 'svelte/transition';

	let outbox_query = liveQueryState(() => {
		return db.outbox.toArray();
	});
	let outbox = $derived([...(outbox_query.current ?? [])]);
	let not_broadly_sent = $derived(outbox.filter((o) => !o.broadly_sent));
	let is_open = $state(false);
	let navbar_already_fixed = $state(false);
	const toggle = () => {
		is_open = !is_open;
		if (is_open) {
			navbar_already_fixed = store.navbar_fixed;
			store.navbar_fixed = true;
		} else if (!navbar_already_fixed) {
			store.navbar_fixed = false;
		}
	};
	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (is_open && event.key === 'Escape') toggle();
		});
	});
</script>

{#if outbox.length === 0}
	<div class="relative">
		<button
			class="btn btn-sm"
			class:btn-primary={is_open}
			class:btn-ghost={!is_open}
			onclick={toggle}
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
			<div class="pointer-events-auto fixed inset-0 z-10 h-16" onclick={toggle}></div>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-10 mt-16 bg-base-200 opacity-50" onclick={toggle}></div>

			<div
				class="fixed right-0 z-20 mt-3 w-[600px] overflow-y-auto bg-base-400 p-4 drop-shadow-2xl"
				style="height: calc(100vh); max-width: calc(100vw - 40px);"
				transition:slide={{ axis: 'x', duration: 100 }}
			>
				<Outbox />
			</div>
		{/if}
	</div>
{/if}
