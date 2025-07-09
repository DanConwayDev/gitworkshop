<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import { IssueKind, kindtoTextLabel, PatchKind, ReplyKind } from '$lib/kinds';
	import type { EventIdString } from '$lib/types';
	import FromNow from './FromNow.svelte';
	import UserHeader from './user/UserHeader.svelte';
	import { GitRepositoryAnnouncement } from '$lib/kind_labels';
	import Container from './Container.svelte';
	import store from '$lib/store.svelte';
	import { kinds, type Filter } from 'nostr-tools';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { nip19 } from 'nostr-tools';
	import { eventIsPrRoot, getRootPointer } from '$lib/utils';
	import { isEventPointer } from 'applesauce-core/helpers';
	import PrOrIssueItem from './prs-or-issues/PrOrIssueItem.svelte';

	let notifications_query = $derived(
		store.logged_in_account
			? query_centre.watchPubkeyNotifications(store.logged_in_account.pubkey)
			: { timeline: [] }
	);

	let events = $derived(
		[...(notifications_query.timeline ?? [])].sort((a, b) => b.created_at - a.created_at) ?? []
	);

	let referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(
			events
				.map((e) => {
					if (e.kind === IssueKind) return e.id;
					if (e.kind === PatchKind && eventIsPrRoot(e)) return e.id;
					let pointer = getRootPointer(e);
					if (pointer && isEventPointer(pointer)) return pointer.id;
				})
				.filter((id) => id !== undefined)
		)
	]);

	let issues_query = $derived(query_centre.fetchIssues(referenced_issues_prs_ids));
	let prs_query = $derived(query_centre.fetchPrs(referenced_issues_prs_ids));
	let issues_prs = $derived(
		referenced_issues_prs_ids.map(
			(id) =>
				issues_query.current?.find((i) => i && i.event.id === id) ??
				prs_query.current?.find((i) => i && i.event.id === id) ??
				undefined
		) ?? []
	);
</script>

<div class="h-full">
	<Container>
		<div class="flex items-center border-b border-primary pb-2">
			<div class="prose flex-grow">
				<h3>Notifications</h3>
			</div>
		</div>
	</Container>
	<ul class=" divide-y divide-base-400">
		{#each issues_prs.slice(0, 10) as table_item}
			<PrOrIssueItem type={table_item?.type ?? 'issue'} {table_item} show_repo />
		{/each}
	</ul>
</div>
