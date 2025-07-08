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

	let notifications_query = $derived(
		store.logged_in_account
			? query_centre.watchPubkeyNotifications(store.logged_in_account.pubkey)
			: { timeline: [] }
	);

	let events = $derived(
		[...(notifications_query.timeline ?? [])].sort((a, b) => b.created_at - a.created_at) ?? []
	);
	let filter: 'unread' | 'dismissed' | 'not broadcast' = $state('unread');
	let unread = $derived([...events]);
	let dismissed = $derived([...events]);
	// let not_broadcast = $derived(events.filter((o) => o.relay_logs.every((l) => !l.success)));
	// let filtered = $derived(
	// 	outbox.filter((o) => {
	// 		if (filter === 'unread') return true;
	// 		if (filter === 'dismissed') return !o.broadly_sent;
	// 		return o.relay_logs.every((l) => !l.success);
	// 	})
	// );
	let selected: EventIdString | undefined = $state(undefined);
</script>

<div class="h-full">
	<Container>
		<div class="flex items-center border-b border-primary pb-2">
			<div class="prose flex-grow">
				<h3>Notifications {notifications_query.timeline.length}</h3>
			</div>
			<div class="flex space-x-2">
				<button
					class="btn btn-xs"
					class:btn-primary={filter === 'unread'}
					onclick={() => {
						filter = 'unread';
					}}>Unread</button
				>
				<div class="indicator">
					{#if unread.length > 0}<span
							class="text-xsm badge indicator-item badge-secondary badge-sm indicator-top"
							>{unread.length}</span
						>{/if}
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'dismissed'}
						onclick={() => {
							filter = 'dismissed';
						}}>Dismissed</button
					>
				</div>
			</div>
		</div>
	</Container>
	{#if events.length > 0}
		{#each events as event}
			<div
				class="group flex w-full items-center justify-between rounded hover:rounded-none hover:bg-base-200"
				class:bg-base-200={selected === event.id}
			>
				<button
					class="flex-grow cursor-pointer"
					onclick={() => {
						if (selected === event.id) selected = undefined;
						else selected = event.id;
					}}
				>
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between p-2">
							<div>
								<div class="badge">{kindtoTextLabel(event.kind)}</div>
								<span class="text-xs"><FromNow unix_seconds={event.created_at} /></span>
							</div>
							<div class="text-sm">put stuff here</div>
						</div>
					</div>
				</button>
				<button
					class="btn btn-ghost btn-xs opacity-0 transition-opacity duration-300 group-hover:opacity-100"
					aria-label="dismiss"
					onclick={() => {
						db.outbox.delete(event.id);
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3 w-3"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>

			{#if selected === event.id}
				<div class="bg-base-300 px-4 py-2">
					<a class="link" href="/{nip19.neventEncode({ id: event.id })}">take me to it</a>
				</div>
			{/if}
		{/each}
	{/if}
</div>
