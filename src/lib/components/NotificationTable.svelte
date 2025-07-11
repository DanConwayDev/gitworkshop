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

	// fetch notification events
	let notifications_query = $derived(
		store.logged_in_account
			? query_centre.watchPubkeyNotifications(store.logged_in_account.pubkey, 0, true)
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

	// pagination
	let pages_items_per_page = 10;
	let pages_current_page = $state(1);
	let pages_total_pages = $derived(Math.ceil(issues_prs.length / pages_items_per_page));
	let pages_start_page_index = $derived((pages_current_page - 1) * pages_items_per_page);
	// svelte-ignore non_reactive_update
	let listElement: HTMLUListElement;
	$effect(() => {
		pages_current_page;
		if (listElement) {
			listElement.scrollIntoView({ behavior: 'smooth' });
		}
	});

	// read / unread status
	let unread_referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(
			events
				.filter(
					(e) =>
						e.created_at > store.notifications_all_read_before &&
						!store.notifications_ids_read_after_date.includes(e.id)
				)
				.map(getRelatedIssueOrPr)
				.filter((id) => id !== undefined)
		)
	]);

	const updateAllReadBefore = () => {
		// update all_ready_before date to oldest unread minus 1s, or 3 days ago, whichever is older
		// determine oldest unread event
		let oldest_unread_event = events
			.filter(
				(e) =>
					e.created_at > store.notifications_all_read_before &&
					!store.notifications_ids_read_after_date.includes(e.id)
			)
			.sort((a, b) => a.created_at - b.created_at)[0];

		const three_days_ago = unixNow() - 60 * 60 * 24 * 3;

		// update all_read_before based on oldest unread event or 3 days ago
		if (oldest_unread_event && oldest_unread_event.created_at < three_days_ago) {
			store.notifications_all_read_before = oldest_unread_event.created_at - 1; // oldest unread minus 1s
		} else {
			store.notifications_all_read_before = three_days_ago;
		}

		// clear ids_read_after_date for events older than all_read_before
		store.notifications_ids_read_after_date = store.notifications_ids_read_after_date.filter(
			(id) => {
				let event = events.find((e) => e.id === id);
				return event && event.created_at >= store.notifications_all_read_before;
			}
		);
	};

	const markAsRead = (pr_issue_id: EventIdString) => {
		let newly_read_ids = events
			.filter(
				(e) =>
					e.created_at > store.notifications_all_read_before &&
					!store.notifications_ids_read_after_date.includes(e.id) &&
					getRelatedIssueOrPr(e) === pr_issue_id
			)
			.map((e) => e.id);
		if (newly_read_ids.length > 0) {
			store.notifications_ids_read_after_date = [
				...store.notifications_ids_read_after_date,
				...newly_read_ids
			];
			updateAllReadBefore();
		}
	};

	const markAsUnread = (pr_issue_id: EventIdString) => {
		let newly_unread_ids = events
			.filter(
				(e) =>
					store.notifications_ids_read_after_date.includes(e.id) &&
					getRelatedIssueOrPr(e) === pr_issue_id
			)
			.map((e) => e.id);

		if (newly_unread_ids.length > 0) {
			store.notifications_ids_read_after_date = store.notifications_ids_read_after_date.filter(
				(id) => !newly_unread_ids.includes(id)
			);
		}
		updateAllReadBefore();
	};

	const markAllAsRead = () => {
		const three_days_ago = unixNow() - 60 * 60 * 24 * 10;
		store.notifications_ids_read_after_date = events
			.filter((e) => e.created_at > three_days_ago)
			.map((e) => e.id);
		store.notifications_all_read_before = three_days_ago;
	};
</script>

{#if store.logged_in_account}
	<div class="h-full">
		<Container no_wrap_on_md>
			<div class="flex items-center pb-2">
				<div class="prose grow">
					<h3>Notifications</h3>
				</div>
			</div>
			<ul
				bind:this={listElement}
				class="divide-base-400 border-base-400 bg-base-100 divide-y rounded-t-lg border"
			>
				<li class="bg-base-200 flex p-2">
					<div class="grow"></div>
					<button class="btn btn-neutral btn-xs" onclick={markAllAsRead}>mark all as read</button>
				</li>
				{#each issues_prs.slice(pages_start_page_index, pages_start_page_index + pages_items_per_page) as table_item}
					<PrOrIssueItem
						type={table_item?.type ?? 'issue'}
						{table_item}
						show_repo
						unread={unread_referenced_issues_prs_ids.includes(table_item?.uuid ?? '')}
						mark_as_read={() => {
							if (table_item) markAsRead(table_item.uuid);
						}}
						mark_as_unread={() => {
							if (table_item) markAsUnread(table_item.uuid);
						}}
						is_notification
					/>
				{/each}
				{#if issues_prs.length === 0}
					<li class="text-neutral-content p-2 py-8 text-center">no notifications found</li>
				{/if}
			</ul>

			{#if issues_prs.length > 0}
				<div class="join mt-4 flex justify-center">
					<button
						class:invisible={pages_current_page === 1}
						class="btn join-item btn-xs"
						onclick={() => (pages_current_page = 1)}>««</button
					>
					<button
						class:invisible={pages_current_page === 1}
						class="btn join-item btn-xs"
						onclick={() => (pages_current_page = Math.max(1, pages_current_page - 1))}>«</button
					>

					{#each Array(pages_total_pages) as _, i}
						{@const page_number = i + 1}
						{#if page_number === pages_current_page || (page_number >= Math.max(1, pages_current_page - 2) && page_number <= Math.min(pages_total_pages, pages_current_page + 2))}
							<button
								class="btn join-item btn-xs"
								class:btn-active={page_number === pages_current_page}
								onclick={() => (pages_current_page = page_number)}
							>
								{page_number}
							</button>
						{/if}
					{/each}

					<button
						class:invisible={pages_current_page === pages_total_pages}
						class="btn join-item btn-xs"
						onclick={() =>
							(pages_current_page = Math.min(pages_total_pages, pages_current_page + 1))}>»</button
					>
					<button
						class:invisible={pages_current_page === pages_total_pages}
						class="btn join-item btn-xs"
						onclick={() => (pages_current_page = pages_total_pages)}>»»</button
					>
				</div>
			{/if}
		</Container>
	</div>
{:else}
	<ContainerCenterPage><div>sign in to see notifications</div></ContainerCenterPage>
{/if}
