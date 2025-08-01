<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import {
		StatusAppliedKind,
		StatusClosedKind,
		StatusDraftKind,
		StatusOpenKind,
		statusKindtoText
	} from '$lib/kinds';
	import store from '$lib/store.svelte';
	import type { IssueOrPrStatus, IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import { unixNow } from 'applesauce-core/helpers';
	import Status from './Status.svelte';
	import accounts_manager from '$lib/accounts';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';

	let { item }: { item: IssueOrPRTableItem } = $props();

	let status = $derived(item.status);

	let item_maintainers_query = $derived(
		liveQueryState(async () => {
			let a_refs = item?.repos ?? [];
			let items = await db.repos.bulkGet(a_refs);
			let maintainers: PubKeyString[] = [];
			items.forEach((item) => item?.maintainers?.forEach((m) => maintainers.push(m)));
			return [item?.author, ...maintainers];
		})
	);
	let item_maintainers = $derived(item_maintainers_query.current ?? [item?.author]);
	let edit_mode = $derived(
		store.logged_in_account && item_maintainers.includes(store.logged_in_account?.pubkey)
	);
	let submitting = $state(false);
	let signed = $state(false);
	let rejected_by_signer = $state(false);

	async function changeStatus(new_status_kind: IssueOrPrStatus) {
		submitting = true;
		let tags: string[][] = [
			['e', item.uuid, '', 'root'],
			...item.repos.map((a_ref) => ['a', a_ref])
			// TODO unique_commit
			// ['r', item.unique_commit]
			// TODO 'mention' revision ids of PRs
		];
		[
			item.author,
			// maintainers
			...item.repos.map((a_ref) => a_ref.split(':')[1])
		].forEach((p) => {
			if (!tags.some((t) => t[1] === p) && p !== store.logged_in_account?.pubkey)
				tags.push(['p', p]);
		});

		const rejectedBySigner = () => {
			rejected_by_signer = true;
			setTimeout(() => {
				submitting = false;
				signed = false;
				rejected_by_signer = false;
			}, 2000);
		};
		try {
			let status_event = await accounts_manager.getActive()?.signEvent(
				$state.snapshot({
					kind: new_status_kind,
					created_at: unixNow(),
					tags: $state.snapshot(tags),
					content: ''
				})
			);
			if (status_event) {
				signed = true;
				query_centre.publishEvent(status_event);
				submitting = false;
				signed = false;
			} else {
				rejectedBySigner();
			}
		} catch {
			rejectedBySigner();
		}
	}
</script>

{#if submitting}
	<button disabled={submitting} class="btn btn-neutral btn-sm align-middle">
		{#if submitting}
			{#if rejected_by_signer}
				Rejected by Signer
			{:else if !signed}
				Signing
			{:else}
				Sending
			{/if}
		{:else}
			Send
		{/if}
	</button>
{:else}
	<div class="dropdown">
		<Status type={item.type} {edit_mode} {status} deleted={item.deleted_ids.includes(item.uuid)} />
		{#if edit_mode}
			<ul
				tabIndex={0}
				class="menu dropdown-content z-1 ml-0 w-52 rounded-box bg-base-300 p-2 shadow"
			>
				{#if status !== StatusDraftKind && item.type !== 'issue'}
					<li class="my-2 pl-0">
						<button
							onclick={() => {
								changeStatus(StatusDraftKind);
							}}
							class="btn btn-neutral btn-sm mx-2 align-middle"
							>{statusKindtoText(StatusDraftKind, item.type)}</button
						>
					</li>
				{/if}
				{#if status !== StatusOpenKind}
					<li class="my-2 pl-0">
						<button
							onclick={() => {
								changeStatus(StatusOpenKind);
							}}
							class="btn btn-success btn-sm mx-2 align-middle"
							>{statusKindtoText(StatusOpenKind, item.type)}</button
						>
					</li>
				{/if}
				{#if status !== StatusAppliedKind}
					<li class="my-2 pl-0">
						<button
							onclick={() => {
								changeStatus(StatusAppliedKind);
							}}
							class="btn btn-primary btn-sm mx-2 align-middle"
							>{statusKindtoText(StatusAppliedKind, item.type)}</button
						>
					</li>
				{/if}
				{#if status !== StatusClosedKind}
					<li class="my-2 pl-0">
						<button
							onclick={() => {
								changeStatus(StatusClosedKind);
							}}
							class="btn btn-neutral btn-sm mx-2 align-middle"
							>{statusKindtoText(StatusClosedKind, item.type)}</button
						>
					</li>
				{/if}
			</ul>
		{/if}
	</div>
{/if}
