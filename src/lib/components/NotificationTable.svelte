<script lang="ts">
	import { browser } from '$app/environment';
	import { IssueKind, PatchKind } from '$lib/kinds';
	import type { EventIdString } from '$lib/types';
	import Container from './Container.svelte';
	import store from '$lib/store.svelte';
	import { type NostrEvent } from 'nostr-tools';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { eventIsPrRoot, getRootPointer } from '$lib/utils';
	import { isEventPointer, unixNow } from 'applesauce-core/helpers';
	import PrOrIssueItem from './prs-or-issues/PrOrIssueItem.svelte';
	import ContainerCenterPage from './ContainerCenterPage.svelte';

	let notifications_query = $derived(
		store.logged_in_account
			? query_centre.watchPubkeyNotifications(store.logged_in_account.pubkey)
			: { timeline: [] }
	);

	let events = $derived(
		[...(notifications_query.timeline ?? [])]
			.filter((e) => store.logged_in_account && e.pubkey !== store.logged_in_account.pubkey)
			.sort((a, b) => b.created_at - a.created_at) ?? []
	);

	// reduce to issues and prs with notifications
	const getRelatedIssueOrPr = (e: NostrEvent): EventIdString | undefined => {
		if (e.kind === IssueKind) return e.id;
		if (e.kind === PatchKind && eventIsPrRoot(e)) return e.id;
		let pointer = getRootPointer(e);
		if (pointer && isEventPointer(pointer)) return pointer.id;
	};

	let referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(events.map(getRelatedIssueOrPr).filter((id) => id !== undefined))
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

	// read / unread status
	const loadAllReadBefore = () =>
		store.logged_in_account && browser
			? Number(
					localStorage.getItem(`notifications_all_read_before:${store.logged_in_account.pubkey}`) ??
						// || '0'
						`${unixNow() - 60 * 60 * 24 * 10}`
				) // || '0'
			: unixNow() - 60 * 60 * 24 * 10;
	const loadReadAfterDate = () =>
		store.logged_in_account && browser
			? JSON.parse(
					localStorage.getItem(
						`notifications_ids_read_after_date:${store.logged_in_account.pubkey}`
					) ?? '[]'
				)
			: [];

	let all_read_before = $state(loadAllReadBefore());
	let ids_read_after_date: EventIdString[] = $state(loadReadAfterDate());

	$effect(() => {
		store.logged_in_account?.pubkey;
		all_read_before = loadAllReadBefore();
		ids_read_after_date = loadReadAfterDate();
	});

	$effect(() => {
		if (store.logged_in_account && ids_read_after_date.length > 0)
			localStorage.setItem(
				`notifications_ids_read_after_date:${store.logged_in_account.pubkey}`,
				JSON.stringify(ids_read_after_date)
			);
	});

	$effect(() => {
		if (store.logged_in_account && all_read_before > 0)
			localStorage.setItem(
				`notifications_all_read_before:${store.logged_in_account.pubkey}`,
				all_read_before.toString()
			);
	});

	let unread_referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(
			events
				.filter((e) => e.created_at > all_read_before && !ids_read_after_date.includes(e.id))
				.map(getRelatedIssueOrPr)
				.filter((id) => id !== undefined)
		)
	]);

	const updateAllReadBefore = () => {
		// update all_ready_before date to oldest unread minus 1s, or 3 days ago, whichever is older
		// determine oldest unread event
		let oldest_unread_event = events
			.filter((e) => e.created_at > all_read_before && !ids_read_after_date.includes(e.id))
			.sort((a, b) => a.created_at - b.created_at)[0];

		const three_days_ago = unixNow() - 60 * 60 * 24 * 3;

		// update all_read_before based on oldest unread event or 3 days ago
		if (oldest_unread_event && oldest_unread_event.created_at < three_days_ago) {
			all_read_before = oldest_unread_event.created_at - 1; // oldest unread minus 1s
		} else {
			all_read_before = three_days_ago;
		}

		// clear ids_read_after_date for events older than all_read_before
		ids_read_after_date = ids_read_after_date.filter((id) => {
			let event = events.find((e) => e.id === id);
			return event && event.created_at >= all_read_before;
		});
	};

	const markAsRead = (pr_issue_id: EventIdString) => {
		let newly_read_ids = events
			.filter(
				(e) =>
					e.created_at > all_read_before &&
					!ids_read_after_date.includes(e.id) &&
					getRelatedIssueOrPr(e) === pr_issue_id
			)
			.map((e) => e.id);
		if (newly_read_ids.length > 0) {
			ids_read_after_date = [...ids_read_after_date, ...newly_read_ids];
			updateAllReadBefore();
		}
	};

	const markAllAsRead = () => {
		const three_days_ago = unixNow() - 60 * 60 * 24 * 3;
		all_read_before = three_days_ago;
		ids_read_after_date = events.filter((e) => e.created_at >= three_days_ago).map((e) => e.id);
	};

	// pagination
	let itemsPerPage = 10;
	let currentPage = $state(1);
	// svelte-ignore non_reactive_update
	let listElement: HTMLUListElement;

	let totalPages = $derived(Math.ceil(issues_prs.length / itemsPerPage));

	let startPage = $derived(
		currentPage === 1
			? 1
			: currentPage === totalPages
				? Math.max(1, totalPages - 2)
				: currentPage - 1
	);

	let endPage = $derived(
		currentPage === 1
			? Math.min(totalPages, 3)
			: currentPage === totalPages
				? totalPages
				: currentPage + 1
	);

	$effect(() => {
		currentPage;
		if (listElement) {
			listElement.scrollIntoView({ behavior: 'smooth' });
		}
	});
</script>

{#if store.logged_in_account}
	<div class="h-full">
		<Container no_wrap_on_md>
			<div class="flex items-center pb-2">
				<div class="prose flex-grow">
					<h3>Notifications</h3>
				</div>
			</div>
			<ul
				bind:this={listElement}
				class="divide-y divide-base-400 rounded-t-lg border border-base-400 bg-base-300"
			>
				<li class="flex p-2">
					<div class="flex-grow"></div>
					<button class="btn btn-neutral btn-xs" onclick={markAllAsRead}>mark all as read</button>
				</li>
				{#each issues_prs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) as table_item}
					<PrOrIssueItem
						type={table_item?.type ?? 'issue'}
						{table_item}
						show_repo
						unread={unread_referenced_issues_prs_ids.includes(table_item?.uuid ?? '')}
						onclick={() => {
							if (table_item) markAsRead(table_item.uuid);
						}}
					/>
				{/each}
				{#if issues_prs.length === 0}
					<li class="p-2 text-center text-neutral-content">none found</li>
				{/if}
			</ul>

			{#if issues_prs.length > 0}
				<div class="join mt-4 flex justify-center">
					<button
						class:invisible={currentPage === 1}
						class="btn join-item btn-sm"
						onclick={() => (currentPage = Math.max(1, currentPage - 1))}>«</button
					>
					{#each Array(endPage - startPage + 1) as _, i}
						<button
							class="btn join-item btn-sm"
							class:btn-active={startPage + i === currentPage}
							onclick={() => {
								currentPage = startPage + i;
							}}
						>
							{startPage + i}
						</button>
					{/each}
					<button
						class:invisible={currentPage === totalPages}
						class="btn join-item btn-sm"
						onclick={() => {
							currentPage = Math.min(totalPages, currentPage + 1);
						}}>»</button
					>
				</div>
			{/if}
		</Container>
	</div>
{:else}
	<ContainerCenterPage><div>sign in to see notifications</div></ContainerCenterPage>
{/if}
