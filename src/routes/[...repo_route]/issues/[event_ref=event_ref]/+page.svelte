<script lang="ts">
	import type { PrOrIssueRouteData } from '$lib/types';
	import Compose from '$lib/components/compose/Compose.svelte';
	import PrOrIssueHeader from '$lib/components/prs-or-issues/PrOrIssueHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { neventOrNoteToHexId } from '$lib/utils';
	import Container from '$lib/components/Container.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	// TODO - handle naddr
	let id = neventOrNoteToHexId(data.event_ref);
	let query = $derived(id ? query_centre.fetchIssue(id) : undefined);
	let table_item = $derived(query?.current);
</script>

<PrOrIssueHeader type="issue" {table_item} />
<Container>
	<Compose content="try pasting in a npub or nprofile" />
</Container>
