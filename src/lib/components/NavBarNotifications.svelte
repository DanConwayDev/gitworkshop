<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store, {
		loadAllArchivedBefore,
		loadAllReadBefore,
		loadArchivedAfterDate,
		loadReadAfterDate
	} from '$lib/store.svelte';

	let earliest_all_read_before = $state($state.snapshot(store.notifications_all_read_before));
	$effect(() => {
		if (store.notifications_all_read_before > earliest_all_read_before)
			earliest_all_read_before = store.notifications_all_read_before;
	});
	let notifications_query = $derived(
		store.logged_in_account
			? query_centre.watchPubkeyNotifications(
					store.logged_in_account.pubkey,
					earliest_all_read_before // only change filters if since would be
				)
			: { timeline: [] }
	);

	let unread = $derived(
		[...(notifications_query.timeline ?? [])].some(
			(e) =>
				store.logged_in_account &&
				e.pubkey !== store.logged_in_account.pubkey &&
				e.created_at > store.notifications_all_read_before &&
				!store.notifications_ids_read_after_date.includes(e.id)
		)
	);

	$effect(() => {
		// required for $effect
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		store.logged_in_account?.pubkey;
		store.notifications_all_read_before = loadAllReadBefore();
		store.notifications_ids_read_after_date = loadReadAfterDate();
		store.notifications_all_archived_before = loadAllArchivedBefore();
		store.notifications_ids_archived_after_date = loadArchivedAfterDate();
	});

	// DO we have an issue here when gitworkshop is refreshed?

	// store.notifications.* get updated in NotificationTable and are written to localStorage here
	$effect(() => {
		if (store.logged_in_account && store.notifications_ids_read_after_date.length > 0)
			localStorage.setItem(
				`notifications_ids_read_after_date:${store.logged_in_account.pubkey}`,
				JSON.stringify(store.notifications_ids_read_after_date)
			);
	});

	$effect(() => {
		if (store.logged_in_account && store.notifications_all_read_before > 0)
			localStorage.setItem(
				`notifications_all_read_before:${store.logged_in_account.pubkey}`,
				store.notifications_all_read_before.toString()
			);
	});

	$effect(() => {
		if (store.logged_in_account && store.notifications_ids_archived_after_date.length > 0)
			localStorage.setItem(
				`notifications_ids_archived_after_date:${store.logged_in_account.pubkey}`,
				JSON.stringify(store.notifications_ids_archived_after_date)
			);
	});

	$effect(() => {
		if (store.logged_in_account && store.notifications_all_archived_before > 0)
			localStorage.setItem(
				`notifications_all_archived_before:${store.logged_in_account.pubkey}`,
				store.notifications_all_archived_before.toString()
			);
	});
</script>

<div class="relative">
	<button
		class="btn btn-ghost btn-sm hover:bg-neutral mx-0 mt-2 px-2"
		onclick={() => {
			goto(resolve('/notifications'));
		}}
	>
		<div class="indicator">
			{#if unread}<span class="indicator-item status status-primary"></span>{/if}
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<title>notifications</title>
				<path
					d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zm-4.22 12a1.999 1.999 0 0 1-3.56 0"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</div>
	</button>
</div>
