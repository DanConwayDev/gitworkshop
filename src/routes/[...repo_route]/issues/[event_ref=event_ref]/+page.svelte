<script lang="ts">
	import type { EventBech32, RepoRouteData } from '$lib/types';
	import Compose from '$lib/components/compose/Compose.svelte';

	let {
		data
	}: {
		data: RepoRouteData & { event_ref: EventBech32 };
	} = $props();
</script>

<div>{data.event_ref}</div>

<Compose content="try pasting in a npub or nprofile" />
