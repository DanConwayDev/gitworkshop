<script lang="ts">
	import type { GitServerStatus } from '$lib/types/git-manager';
	import type { SvelteMap } from 'svelte/reactivity';

	let {
		server_status
	}: {
		server_status: SvelteMap<string, GitServerStatus>;
	} = $props();

	let icon_state: [
		'success' | 'warning' | 'error' | undefined,
		'success' | 'warning' | 'error' | undefined,
		'success' | 'warning' | 'error' | undefined
	] = $derived.by(() => {
		let statuses: ('success' | 'warning' | 'error' | undefined)[] = Array.from(
			server_status.entries()
		).map(([_, e]) => {
			if (e.state === 'fetched') return 'success';
			if (e.state === 'connected') return 'success';
			if (e.state === 'connecting') return 'warning';
			if (e.state === 'fetching') return 'warning';
			return 'error';
		});

		// sort success first, then warning, then error
		statuses.sort((a, b) => {
			const rank = (s: (typeof statuses)[number]) =>
				s === 'success' ? 0 : s === 'warning' ? 1 : 2;
			return rank(a) - rank(b);
		});

		// trim down to at most 3 with the specified removal priority:
		// prefer removing last 'error', then last 'warning', then last 'success'
		while (statuses.length > 3) {
			const lastIndexOf = (v: (typeof statuses)[number]) => statuses.lastIndexOf(v);
			if (lastIndexOf('error') !== -1 && statuses.filter((s) => s === 'error').length > 1) {
				statuses.splice(lastIndexOf('error'), 1);
				continue;
			}
			if (lastIndexOf('warning') !== -1 && statuses.filter((s) => s === 'warning').length > 1) {
				statuses.splice(lastIndexOf('warning'), 1);
				continue;
			}
			statuses.splice(lastIndexOf('success'), 1);
		}

		// fill until length is 3 with undefined
		while (statuses.length < 3) statuses.push(undefined);
		return statuses as [
			'success' | 'warning' | 'error' | undefined,
			'success' | 'warning' | 'error' | undefined,
			'success' | 'warning' | 'error' | undefined
		];
	});
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" class="inline h-4 w-4">
	<!-- original stacked server path (unchanged) -->
	<path
		class="fill-neutral-content/40"
		d="M0 2C0 .9.9 0 2 0h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zM12 2v2h2V2zm4 0v2h2V2zm-4 7v2h2V9zm4 0v2h2V9zm-4 7v2h2v-2zm4 0v2h2v-2z"
	/>

	<!-- lights: positioned to align with the centers of the three rows and two columns -->
	<!-- row Y positions chosen to vertically center within each server band -->
	<!-- column X positions match the small rectangles' horizontal placement -->
	<g pointer-events="none" transform="translate(0,0)">
		<!-- Top row lights -->
		{#if icon_state[0]}
			<rect x="12" y="2" width="2" height="2" class="fill-{icon_state[0]}" />
			<rect x="16" y="2" width="2" height="2" class="fill-{icon_state[0]}" />
		{/if}
		<!-- Middle row lights -->
		{#if icon_state[1]}
			<rect x="12" y="9" width="2" height="2" class="fill-{icon_state[1]}" />
			<rect x="16" y="9" width="2" height="2" class="fill-{icon_state[1]}" />
		{/if}
		<!-- Bottom row lights -->
		{#if icon_state[2]}
			<rect x="12" y="16" width="2" height="2" class="fill-{icon_state[2]}" />
			<rect x="16" y="16" width="2" height="2" class="fill-{icon_state[2]}" />
		{/if}
	</g>
</svg>
