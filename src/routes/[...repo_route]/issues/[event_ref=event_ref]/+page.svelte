<script lang="ts">
	import type { EventBech32, RepoRouteData } from '$lib/types';

	let {
		data
	}: {
		data: RepoRouteData & { event_ref: EventBech32 };
	} = $props();
</script>

<div>{data.event_ref}</div>
