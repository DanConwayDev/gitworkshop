<script lang="ts">
	import { onMount } from 'svelte';
	import { IssueKind, PatchKind } from '$lib/kinds';
	import { isRelayCheckFound, type EventIdString } from '$lib/types';
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

	const notificationInView = (e: NostrEvent, view: 'inbox' | 'archived' | 'all'): boolean => {
		const archived =
			e.created_at > store.notifications_all_archived_before &&
			!store.notifications_ids_archived_after_date.includes(e.id);
		if (current_view == 'inbox') return archived;
		if (current_view == 'archived') return !archived;
		return true;
	};

	let events_in_view = $derived(
		[...(notifications_query.timeline ?? [])].filter((e) => notificationInView(e, current_view))
	);

	// reduce to issues and prs with notifications
	const getRelatedIssueOrPr = (e: NostrEvent): EventIdString | undefined => {
		if (e.kind === IssueKind) return e.id;
		if (e.kind === PatchKind && eventIsPrRoot(e)) return e.id;
		let pointer = getRootPointer(e);
		if (pointer && isEventPointer(pointer)) return pointer.id;
	};

	let referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(events_in_view.map(getRelatedIssueOrPr).filter((id) => id !== undefined))
	]);

	// pagination
	let pages_items_per_page = 10;
	let pages_current_page = $state(1);
	let pages_total_pages = $derived(
		Math.ceil(referenced_issues_prs_ids.length / pages_items_per_page)
	);
	let pages_start_page_index = $derived((pages_current_page - 1) * pages_items_per_page);
	let page_slice_of_referenced_issues_prs_ids = $derived(
		referenced_issues_prs_ids.slice(
			pages_start_page_index,
			pages_start_page_index + pages_items_per_page
		)
	);
	// svelte-ignore non_reactive_update
	let listElement: HTMLUListElement;
	$effect(() => {
		pages_current_page;
		if (listElement) {
			listElement.scrollIntoView({ behavior: 'smooth' });
		}
	});

	// fetch PR / Issue
	let page_issues_query = $derived(query_centre.fetchIssues(referenced_issues_prs_ids));
	let page_prs_query = $derived(query_centre.fetchPrs(referenced_issues_prs_ids));
	let page_issues_prs = $derived(
		page_slice_of_referenced_issues_prs_ids.map(
			(id) =>
				page_issues_query.current?.find((i) => i && i.event.id === id) ??
				page_prs_query.current?.find((i) => i && i.event.id === id) ??
				undefined
		) ?? []
	);

	// fetch missing data
	let fetched_threads: EventIdString[] = $state([]);
	// fetch missing PRs and Issue
	let had_chance_to_load_from_cache = $state(false);
	onMount(() => {
		setTimeout(() => {
			had_chance_to_load_from_cache = true;
		}, 2000);
	});
	let missing_issue_prs_on_page = $derived(
		page_slice_of_referenced_issues_prs_ids.filter(
			(_, index) => page_issues_prs[index] === undefined
		)
	);
	$effect(() => {
		if (had_chance_to_load_from_cache)
			missing_issue_prs_on_page.forEach((id) => {
				if (!fetched_threads.includes(id)) {
					fetched_threads = [...fetched_threads, id];
					query_centre.fetchEvent({ id: id }, true);
				}
			});
	});

	// fetch threads
	let page_issue_prs_loaded = $derived(
		page_issues_prs.filter((e, index) => e && e.repos[0]).filter((i) => i !== undefined) // for typings
	);

	$effect(() => {
		if (had_chance_to_load_from_cache)
			page_issue_prs_loaded.forEach((table_item) => {
				if (!fetched_threads.includes(table_item.uuid)) {
					fetched_threads = [...fetched_threads, table_item.uuid];
					query_centre.fetchEvent(
						{
							id: table_item.uuid,
							relays: Object.entries(table_item.relays_info)
								.filter(([url, huristicsForRelay]) =>
									huristicsForRelay.huristics.some(isRelayCheckFound)
								)
								.map(([url]) => url)
						},
						true
					);
				}
			});
	});

	// read / unread status
	let unread_referenced_issues_prs_ids: EventIdString[] = $derived([
		...new Set(
			events_in_view
				.filter(
					(e) =>
						e.created_at > store.notifications_all_read_before &&
						!store.notifications_ids_read_after_date.includes(e.id)
				)
				.map(getRelatedIssueOrPr)
				.filter((id) => id !== undefined)
		)
	]);

	let current_view: 'inbox' | 'archived' | 'all' = $state('inbox');

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

	const updateAllArchivedBefore = () => {
		let oldest_unarchived_event = events
			.filter(
				(e) =>
					e.created_at > store.notifications_all_archived_before &&
					!store.notifications_ids_archived_after_date.includes(e.id)
			)
			.sort((a, b) => a.created_at - b.created_at)[0];

		const three_days_ago = unixNow() - 60 * 60 * 24 * 3;

		if (oldest_unarchived_event && oldest_unarchived_event.created_at < three_days_ago) {
			store.notifications_all_archived_before = oldest_unarchived_event.created_at - 1;
		} else {
			store.notifications_all_archived_before = three_days_ago;
		}

		store.notifications_ids_archived_after_date =
			store.notifications_ids_archived_after_date.filter((id) => {
				let event = events.find((e) => e.id === id);
				return event && event.created_at >= store.notifications_all_archived_before;
			});
	};

	const isArchived = (pr_issue_id: EventIdString) => {
		const related_events_ids = events
			.filter((e) => getRelatedIssueOrPr(e) === pr_issue_id)
			.map((e) => e.id);
		return related_events_ids.every(
			(id) =>
				store.notifications_ids_archived_after_date.includes(id) ||
				(events.find((e) => e.id === id)?.created_at ?? 0) < store.notifications_all_archived_before
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
		const old_notifications_all_read_before = store.notifications_all_read_before;

		// 1. Identify all events that are part of the pr_issue_id
		let events_for_current_pr_issue = events.filter((e) => getRelatedIssueOrPr(e) === pr_issue_id);
		let ids_of_events_for_pr_issue = events_for_current_pr_issue.map((e) => e.id);

		// 2. Remove these specific event IDs from notifications_ids_read_after_date
		store.notifications_ids_read_after_date = store.notifications_ids_read_after_date.filter(
			(id) => !ids_of_events_for_pr_issue.includes(id)
		);

		// 3. Determine the earliest created_at that would now be unread for this pr_issue_id
		let min_created_at_for_pr_issue = Number.MAX_SAFE_INTEGER;
		for (const e of events_for_current_pr_issue) {
			if (e.created_at < min_created_at_for_pr_issue) {
				min_created_at_for_pr_issue = e.created_at;
			}
		}

		// Calculate proposed new notifications_all_read_before
		let proposed_notifications_all_read_before = old_notifications_all_read_before;
		if (
			min_created_at_for_pr_issue !== Number.MAX_SAFE_INTEGER &&
			min_created_at_for_pr_issue < old_notifications_all_read_before
		) {
			proposed_notifications_all_read_before = min_created_at_for_pr_issue - 1;
		}

		// 4. If notifications_all_read_before is effectively moving backwards,
		// identify events that were "read by age" from the old threshold
		// and add them to notifications_ids_read_after_date if they are not
		// part of the current pr_issue_id being marked unread.
		if (proposed_notifications_all_read_before < old_notifications_all_read_before) {
			let events_to_re_mark_as_read = events
				.filter(
					(e) =>
						e.created_at >= proposed_notifications_all_read_before && // Events that are now "above" the new threshold
						e.created_at < old_notifications_all_read_before && // Events that were "below" the old threshold
						!ids_of_events_for_pr_issue.includes(e.id) && // Not part of the current PR/Issue being unread
						!store.notifications_ids_read_after_date.includes(e.id) // Not already explicitly read
				)
				.map((e) => e.id);

			store.notifications_ids_read_after_date = [
				...store.notifications_ids_read_after_date,
				...events_to_re_mark_as_read
			];
		}

		// Overwrite notifications_all_read_before with the calculated proposed value
		store.notifications_all_read_before = proposed_notifications_all_read_before;

		// 5. Call updateAllReadBefore to finalize state (it will re-filter based on new notifications_all_read_before)
		updateAllReadBefore();
	};

	const markAsArchived = (pr_issue_id: EventIdString) => {
		let newly_archived_ids = events
			.filter(
				(e) =>
					e.created_at > store.notifications_all_archived_before &&
					!store.notifications_ids_archived_after_date.includes(e.id) &&
					getRelatedIssueOrPr(e) === pr_issue_id
			)
			.map((e) => e.id);
		if (newly_archived_ids.length > 0) {
			store.notifications_ids_archived_after_date = [
				...store.notifications_ids_archived_after_date,
				...newly_archived_ids
			];
			updateAllArchivedBefore();
			markAsRead(pr_issue_id); // Archived items are always read
		}
	};

	const markAsUnarchived = (pr_issue_id: EventIdString) => {
		const old_notifications_all_archived_before = store.notifications_all_archived_before;

		let events_for_current_pr_issue = events.filter((e) => getRelatedIssueOrPr(e) === pr_issue_id);
		let ids_of_events_for_pr_issue = events_for_current_pr_issue.map((e) => e.id);

		store.notifications_ids_archived_after_date =
			store.notifications_ids_archived_after_date.filter(
				(id) => !ids_of_events_for_pr_issue.includes(id)
			);

		let min_created_at_for_pr_issue = Number.MAX_SAFE_INTEGER;
		for (const e of events_for_current_pr_issue) {
			if (e.created_at < min_created_at_for_pr_issue) {
				min_created_at_for_pr_issue = e.created_at;
			}
		}

		let proposed_notifications_all_archived_before = old_notifications_all_archived_before;
		if (
			min_created_at_for_pr_issue !== Number.MAX_SAFE_INTEGER &&
			min_created_at_for_pr_issue < old_notifications_all_archived_before
		) {
			proposed_notifications_all_archived_before = min_created_at_for_pr_issue - 1;
		}

		if (proposed_notifications_all_archived_before < old_notifications_all_archived_before) {
			let events_to_re_mark_as_archived = events
				.filter(
					(e) =>
						e.created_at >= proposed_notifications_all_archived_before &&
						e.created_at < old_notifications_all_archived_before &&
						!ids_of_events_for_pr_issue.includes(e.id) &&
						!store.notifications_ids_archived_after_date.includes(e.id)
				)
				.map((e) => e.id);

			store.notifications_ids_archived_after_date = [
				...store.notifications_ids_archived_after_date,
				...events_to_re_mark_as_archived
			];
		}

		store.notifications_all_archived_before = proposed_notifications_all_archived_before;

		updateAllArchivedBefore();
	};

	const markAllAsRead = () => {
		const three_days_ago = unixNow() - 60 * 60 * 24 * 10;
		store.notifications_ids_read_after_date = events
			.filter((e) => e.created_at > three_days_ago && !isArchived(getRelatedIssueOrPr(e) ?? ''))
			.map((e) => e.id);
		store.notifications_all_read_before = three_days_ago;
	};

	const markAllAsArchived = () => {
		store.notifications_ids_archived_after_date = events
			.filter((e) => !isArchived(getRelatedIssueOrPr(e) ?? ''))
			.map((e) => e.id);
		store.notifications_all_archived_before = unixNow() - 60 * 60 * 24 * 10; // archive all for 10 days ago

		// Also mark all as read
		markAllAsRead();
	};
</script>

{#if store.logged_in_account}
	<div class="h-full">
		<Container no_wrap_on_md>
			<div class="flex items-center pb-2">
				<div class="grow">
					<div class="prose"><h3>Notifications</h3></div>
				</div>
				<div class="tabs tabs-boxed">
					<button
						class="tab"
						class:tab-active={current_view === 'inbox'}
						onclick={() => {
							pages_current_page = 1;
							current_view = 'inbox';
						}}>Inbox</button
					>
					<button
						class="tab"
						class:tab-active={current_view === 'archived'}
						onclick={() => {
							pages_current_page = 1;
							current_view = 'archived';
						}}>Archived</button
					>
					<button
						class="tab"
						class:tab-active={current_view === 'all'}
						onclick={() => {
							pages_current_page = 1;
							current_view = 'all';
						}}>All</button
					>
				</div>
			</div>
			<ul
				bind:this={listElement}
				class="divide-base-400 border-base-400 bg-base-100 divide-y rounded-t-lg border"
			>
				<li class="bg-base-200 flex p-2">
					<div class="grow"></div>
					{#if current_view === 'inbox'}
						<button class="btn btn-neutral btn-xs" onclick={markAllAsRead}>mark all as read</button>
						<div class="w-2"></div>
						<button class="btn btn-neutral btn-xs" onclick={markAllAsArchived}>archive all</button>
					{/if}
					{#if current_view === 'archived'}
						<button
							class="btn btn-neutral btn-xs"
							onclick={() => {
								store.notifications_all_archived_before = unixNow() - 1;
							}}>move all to inbox</button
						>
					{/if}
				</li>
				{#each page_issues_prs as table_item}
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
						mark_as_archived={() => {
							if (table_item) markAsArchived(table_item.uuid);
						}}
						mark_as_unarchived={() => {
							if (table_item) markAsUnarchived(table_item.uuid);
						}}
						is_archived={table_item ? isArchived(table_item.uuid) : false}
						notification_view={current_view}
					/>
				{/each}
				{#if page_issues_prs.length === 0}
					<li class="text-neutral-content p-2 py-8 text-center">no notifications found</li>
				{/if}
			</ul>
			{#if page_issues_prs.length > 0}
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
