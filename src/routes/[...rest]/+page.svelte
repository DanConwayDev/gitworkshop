<script lang="ts">
	import { goto } from '$app/navigation';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { IssueKind, PatchKind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { EventIdString, Nevent, Nnote, RepoRef } from '$lib/types';
	import { eventIsPrRoot, getRootPointer } from '$lib/utils';
	import { isEventPointer } from 'applesauce-core/helpers';
	import { nip19 } from 'nostr-tools';

	let { data }: { data: { rest: string } } = $props();

	let event_ref = $derived(data.rest.split('/')[0]);
	let decoded = $derived.by(() => {
		try {
			let d = nip19.decode(event_ref);
			if (d.type === 'nevent' || d.type === 'note' || d.type === 'naddr') return d;
		} catch {
			/* empty */
		}
		return undefined;
	});

	let pointer = $derived(
		decoded?.type === 'nevent'
			? decoded.data
			: decoded?.type === 'note'
				? { id: decoded.data }
				: undefined
	);

	let pr_query = $derived(pointer ? query_centre.fetchPr(pointer.id) : undefined);
	let issue_query = $derived(pointer ? query_centre.fetchIssue(pointer.id) : undefined);
	let event_query = $derived(pointer ? query_centre.fetchEvent(pointer) : undefined);

	let root_pointer = $derived(
		event_query &&
			event_query.event &&
			event_query.event.kind !== IssueKind &&
			(event_query.event.kind !== PatchKind || !eventIsPrRoot(event_query.event))
			? getRootPointer(event_query.event)
			: undefined
	);
	let root_event_pointer = $derived(
		// using isEventPointer stops us falling back to an 'a' tagged as root
		root_pointer && isEventPointer(root_pointer) ? root_pointer : undefined
	);
	let root_event_query = $derived(
		root_event_pointer ? query_centre.fetchEvent(root_event_pointer) : undefined
	);
	let root_pr_query = $derived(
		root_event_pointer ? query_centre.fetchPr(root_event_pointer.id) : undefined
	);
	let root_issue_query = $derived(
		root_event_pointer ? query_centre.fetchIssue(root_event_pointer.id) : undefined
	);
	let going = $state(false);

	const routeToEvent = (
		bech32: Nevent | Nnote,
		a_ref: RepoRef,
		type: 'pr' | 'issue',
		child_event_id?: EventIdString
	): 'pr' | 'issue' => {
		going = true;
		let fagment = child_event_id ? `#${child_event_id.substring(0, 15)}` : '';
		goto(`/${new RepoRouteStringCreator(a_ref).s}/${type}s/${bech32}${fagment}`);
		return type;
	};
	let event_type: 'issue' | 'pr' | 'in_thread' | 'other' | undefined = $derived.by(() => {
		if (pr_query?.current) return 'pr';
		if (issue_query?.current) return 'issue';
		if (root_event_pointer) return 'in_thread';
		if (event_query?.event) return 'other';
		return undefined;
	});

	let root_event_type: 'issue' | 'pr' | 'other' | undefined = $derived.by(() => {
		if (event_query && event_query?.event && root_event_pointer) {
			if (root_pr_query?.current) return 'pr';
			if (root_issue_query?.current) return 'issue';
		}
		const isnt_issue_or_pr_root =
			root_event_query?.event &&
			!eventIsPrRoot(root_event_query.event) &&
			root_event_query.event.kind !== IssueKind;
		if (isnt_issue_or_pr_root) return 'other';
		return undefined;
	});

	$effect(() => {
		if (event_type === 'pr' && pr_query?.current)
			routeToEvent(event_ref as Nevent, pr_query?.current.repos[0], event_type);
		if (event_type === 'issue' && issue_query?.current)
			routeToEvent(event_ref as Nevent, issue_query?.current.repos[0], event_type);
		if (root_event_type && event_query && event_query?.event && root_event_pointer) {
			if (root_event_type === 'pr' && root_pr_query?.current)
				routeToEvent(
					nip19.neventEncode(root_event_pointer),
					root_pr_query?.current.repos[0],
					root_event_type,
					event_query.event.id
				);
			if (root_event_type === 'issue' && root_issue_query?.current)
				routeToEvent(
					nip19.neventEncode(root_event_pointer),
					root_issue_query?.current.repos[0],
					root_event_type,
					event_query.event.id
				);
		}
	});

	// TODO redirect repo state announcements
</script>

<svelte:head>
	<title>gitworkshop.dev</title>
</svelte:head>

{#snippet loadingContainer(text: string)}
	<ContainerCenterPage>
		<div class="py-9 text-center">
			<span class="color-neutral-content loading loading-spinner loading-lg mb-4 opacity-25"></span>
			<div class="text-neutral-content">{text}</div>
		</div>
	</ContainerCenterPage>
{/snippet}

{#if !decoded}
	<NotFound404Page />
{:else if decoded.type === 'naddr'}
	<NotFound404Page
		msg="gitworkshop.dev doesnt no how to redirect naddr urls that arn't Git Repository Announcement event"
	/>
{:else if event_type}
	{#if event_type === 'other'}
		<!-- {@render loadingContainer(`found event - fetching context`)} -->
		<NotFound404Page
			msg="Cannot open event as it doesnt appear to relate to a Git Nostr entity ${event_ref}"
		/>
		<!-- TODO build routing  -->
	{:else if event_type === 'in_thread'}
		{#if !root_event_type}
			{@render loadingContainer(`searching relays for event thread related to ${event_ref}`)}
		{:else if root_event_type === 'other'}
			<NotFound404Page
				msg="Cannot open event as it, or it's root event, doesnt appear to relate to a Git Nostr entity ${event_ref}"
			/>
		{:else}
			{@render loadingContainer(`routing to ${root_event_type} page`)}
		{/if}
	{:else}
		{@render loadingContainer(`routing to ${event_type} page`)}
	{/if}
{:else}
	{@render loadingContainer(`searching relays for event ${event_ref}`)}
{/if}
<!-- TODO event not found - show relays searched  -->
