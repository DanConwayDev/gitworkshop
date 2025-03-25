<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import { eventToNip19, getStandardnip10ReplyTags, getStandardnip22ReplyTags } from '$lib/utils';
	import CopyField from '../CopyField.svelte';
	import { onMount, type Snippet } from 'svelte';
	import store from '$lib/store.svelte';
	import ComposeReply from '../compose/ComposeReply.svelte';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import accounts_manager from '$lib/accounts';
	import { unixNow } from 'applesauce-core/helpers';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { Reaction } from 'nostr-tools/kinds';
	import { ShortTextNote } from '$lib/kind_labels';
	import { DeletionKind, kindtoTextLabel } from '$lib/kinds';
	import { isReplaceable, getEventUID } from 'applesauce-core/helpers/event';

	let {
		event,
		issue_or_pr_table_item,
		embedded = false,
		children,
		reactions = []
	}: {
		event: NostrEvent;
		issue_or_pr_table_item?: IssueOrPRTableItem;
		embedded?: boolean;
		children: Snippet;
		reactions?: NostrEvent[];
	} = $props();

	let show_compose = $state(false);
	let show_more = $state(false);
	let show_delete_sure_modal = $state(false);
	let show_raw_json_modal = $state(false);
	let show_share_modal = $state(false);
	let modal_open = $derived(show_raw_json_modal || show_share_modal || show_delete_sure_modal);
	const replySent = () => {
		show_compose = false;
	};
	const closeModals = () => {
		show_delete_sure_modal = false;
		show_raw_json_modal = false;
		show_share_modal = false;
		show_delete_sure_modal = false;
		event_to_delete_override = undefined;
	};
	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (modal_open && event.key === 'Escape') closeModals();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (
				modal_open &&
				target.classList.contains('modal-open') &&
				!target.classList.contains('modal-box')
			)
				closeModals();
		});
	});

	let grouped_reactions = $derived(
		reactions.reduce((acc: { [reaction: string]: Set<PubKeyString> }, reaction) => {
			if (!acc[reaction.content]) acc[reaction.content] = new Set();
			acc[reaction.content].add(reaction.pubkey);
			return acc;
		}, {})
	);
	let show_reactions = $state(false);
	let sending_reaction = $state(false);
	const sendReaction = async (reaction: string) => {
		let signer = accounts_manager.getActive();
		if (sending_reaction || !signer) return;
		sending_reaction = true;

		let tags: string[][] = [
			...(event.kind === ShortTextNote
				? getStandardnip10ReplyTags(event, issue_or_pr_table_item)
				: getStandardnip22ReplyTags(event, issue_or_pr_table_item))
		];
		([] as string[][]).forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[1] === t[1])) tags.push(t);
		});
		try {
			let event = await signer.signEvent({
				kind: Reaction,
				created_at: unixNow(),
				tags,
				content: reaction
			});
			if (event) {
				query_centre.publishEvent(event);
			}
		} catch {
			/* empty */
		}
		setTimeout(() => {
			sending_reaction = false;
			show_reactions = false;
		}, 500);
	};
	let sending_deletion = $state(false);
	let event_to_delete_override: NostrEvent | undefined = $state(undefined);
	let event_to_delete = $derived(event_to_delete_override ?? event);
	let rejected_deletion = $state(false);
	let deletion_rationale = $state('');
	const sendDeletion = async () => {
		let signer = accounts_manager.getActive();
		if (sending_deletion || !signer) return;
		sending_deletion = true;
		let tags: string[][] = [
			isReplaceable(event.kind) ? ['a', getEventUID(event_to_delete)] : ['e', event_to_delete.id],
			['k', event_to_delete.kind.toString()]
		];
		([] as string[][]).forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[1] === t[1])) tags.push(t);
		});
		try {
			let d_event = await signer.signEvent({
				kind: DeletionKind,
				created_at: unixNow(),
				tags,
				content: $state.snapshot(deletion_rationale)
			});
			if (d_event) {
				query_centre.publishEvent(d_event);
				// TODO - enhance publishEvent to send to relays related to deleted event
			}
		} catch {
			rejected_deletion = true;
			sending_deletion = false;
			/* empty */
		}
		setTimeout(
			() => {
				if (!rejected_deletion) {
					show_delete_sure_modal = false;
					deletion_rationale = '';
					event_to_delete_override = undefined;
				}
				rejected_deletion = false;
				sending_deletion = false;
			},
			rejected_deletion ? 1500 : 500
		);
	};
</script>

{#snippet addReactionButton(reaction: string, in_group = false)}
	{#if reactions.some((r) => r.pubkey === store.logged_in_account?.pubkey && r.content === reaction)}
		<button
			class="btn btn-primary btn-xs h-full {in_group ? 'join-item py-2' : ''}"
			disabled={sending_reaction}
			aria-label="delete reaction"
			onclick={() => {
				const r = reactions.find(
					(r) => r.pubkey === store.logged_in_account?.pubkey && r.content === reaction
				);
				if (r) {
					event_to_delete_override = r;
					show_delete_sure_modal = true;
				}
			}}
		>
			{reaction}
		</button>
	{:else}
		<button
			class="btn btn-neutral btn-xs h-full {in_group ? 'join-item py-2' : ''}"
			disabled={sending_reaction}
			onclick={() => {
				sendReaction(reaction);
			}}
		>
			{reaction}
		</button>
	{/if}
{/snippet}

{#snippet reactionGroup(reaction: string)}
	<div
		class="join mr-2 shadow-lg {grouped_reactions[reaction].has(
			store.logged_in_account?.pubkey ?? ''
		)
			? 'border border-primary'
			: ''}"
	>
		{#if store.logged_in_account && !grouped_reactions[reaction].has(store.logged_in_account.pubkey)}
			{@render addReactionButton(reaction, true)}
		{:else}
			<span class="join-item flex items-center bg-base-400 p-2 pl-3 pr-1 text-xs">
				{reaction}
			</span>
		{/if}
		<div class="join-item inline-flex items-center rounded-lg bg-base-400 py-1">
			{#each grouped_reactions[reaction] as pubkey}
				<div class="mx-2 flex items-center">
					<div
						class="badge flex items-center"
						class:bg-base-300={store.logged_in_account?.pubkey === pubkey}
						class:bg-base-100={!(store.logged_in_account?.pubkey === pubkey)}
					>
						<UserHeader user={pubkey} inline size="xs" />
					</div>
				</div>
			{/each}
		</div>
	</div>
{/snippet}

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
	<div class="flex">
		<div class="flex-auto">
			<UserHeader user={event.pubkey} in_event_header={true} />
		</div>
		<span class="m-auto text-xs"><FromNow unix_seconds={event.created_at} /></span>
		<div class="m-auto ml-2">
			{#if show_more || !(store.logged_in_account?.pubkey === event?.pubkey)}
				{#if event}
					{#if store.logged_in_account?.pubkey === event?.pubkey}
						<div class="tooltip align-middle" data-tip="delete">
							<button
								onclick={() => {
									show_delete_sure_modal = true;
								}}
								class="btn btn-xs text-neutral-content"
								aria-label="delete"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
									><path
										fill="currentColor"
										d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3zm0 5h2v9H9zm4 0h2v9h-2z"
									/></svg
								>
							</button>
						</div>
					{/if}
					<div class="tooltip align-middle" data-tip="event json">
						<button
							onclick={() => {
								show_raw_json_modal = true;
							}}
							class="btn btn-xs text-neutral-content"
						>
							<!-- https://icon-sets.iconify.design/ph/brackets-curly-bold -->
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256"
								><path
									fill="currentColor"
									d="M54.8 119.49a35.06 35.06 0 0 1-5.75 8.51a35.06 35.06 0 0 1 5.75 8.51C60 147.24 60 159.83 60 172c0 25.94 1.84 32 20 32a12 12 0 0 1 0 24c-19.14 0-32.2-6.9-38.8-20.51C36 196.76 36 184.17 36 172c0-25.94-1.84-32-20-32a12 12 0 0 1 0-24c18.16 0 20-6.06 20-32c0-12.17 0-24.76 5.2-35.49C47.8 34.9 60.86 28 80 28a12 12 0 0 1 0 24c-18.16 0-20 6.06-20 32c0 12.17 0 24.76-5.2 35.49M240 116c-18.16 0-20-6.06-20-32c0-12.17 0-24.76-5.2-35.49C208.2 34.9 195.14 28 176 28a12 12 0 0 0 0 24c18.16 0 20 6.06 20 32c0 12.17 0 24.76 5.2 35.49A35.06 35.06 0 0 0 207 128a35.06 35.06 0 0 0-5.75 8.51C196 147.24 196 159.83 196 172c0 25.94-1.84 32-20 32a12 12 0 0 0 0 24c19.14 0 32.2-6.9 38.8-20.51c5.2-10.73 5.2-23.32 5.2-35.49c0-25.94 1.84-32 20-32a12 12 0 0 0 0-24"
								/></svg
							></button
						>
					</div>
					{#if show_raw_json_modal}
						<dialog class="modal" class:modal-open={show_raw_json_modal}>
							<div class="modal-box relative max-w-full text-wrap text-xs">
								<div class="h-full overflow-y-auto overflow-x-hidden">
									<pre class="whitespace-pre-wrap">{JSON.stringify(event, null, 2)}</pre>
								</div>
								<button class="btn btn-sm absolute bottom-4 right-4 z-10" onclick={closeModals}
									>Close</button
								>
								<!-- Floating button -->
							</div>
						</dialog>
					{/if}
				{/if}
			{:else}
				<div class="tooltip align-middle" data-tip="more options">
					<button
						onclick={() => {
							show_more = !show_more;
						}}
						class="btn btn-xs text-neutral-content"
						aria-label="more options"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256"
							><path
								fill="currentColor"
								d="M68 172a16 16 0 1 1-16 16a16 16 0 0 1 16-16zm60 0a16 16 0 1 1-16 16a16 16 0 0 1 16-16zm60 0a16 16 0 1 1-16 16a16 16 0 0 1 16-16z"
							/></svg
						>
					</button>
				</div>
			{/if}
			{#if event}
				<div class="tooltip align-middle" data-tip="share">
					<button
						onclick={() => {
							show_share_modal = true;
						}}
						class="btn btn-xs text-neutral-content"
					>
						<!-- https://icon-sets.iconify.design/ph/share-network-bold/ -->
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256"
							><path
								fill="currentColor"
								d="M176 156a43.78 43.78 0 0 0-29.09 11l-40.81-26.2a44.07 44.07 0 0 0 0-25.6L146.91 89a43.83 43.83 0 1 0-13-20.17L93.09 95a44 44 0 1 0 0 65.94l40.81 26.26A44 44 0 1 0 176 156m0-120a20 20 0 1 1-20 20a20 20 0 0 1 20-20M64 148a20 20 0 1 1 20-20a20 20 0 0 1-20 20m112 72a20 20 0 1 1 20-20a20 20 0 0 1-20 20"
							/></svg
						></button
					>
				</div>
				{#if show_share_modal}
					<dialog class="modal" class:modal-open={show_share_modal}>
						<div class="modal-box max-w-lg text-wrap">
							<div class="prose"><h3>Share</h3></div>
							<CopyField
								label="gitworkshop.dev"
								content={`https://gitworkshop.dev/${eventToNip19(event)}`}
								border_color="secondary"
							/>
							<CopyField
								label="nostr address"
								content={`nostr:${eventToNip19(event)}`}
								border_color="secondary"
							/>
							<CopyField
								label="njump"
								content={`https://njump.me/${eventToNip19(event)}`}
								border_color="secondary"
							/>
							<CopyField label="raw event id" content={event.id} border_color="neutral-content" />
							<div class="modal-action">
								<button class="btn btn-sm" onclick={closeModals}>Close</button>
							</div>
						</div>
					</dialog>
				{/if}
			{/if}
			{#if !embedded && !show_compose && store.logged_in_account}
				<div class="tooltip align-middle" data-tip="reply">
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						onclick={() => {
							show_compose = true;
						}}
						class="btn btn-xs"
						><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"
							><path
								fill="currentColor"
								d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275a.749.749 0 0 1-.734-.215L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0"
							/></svg
						></button
					>
				</div>
			{/if}
		</div>
	</div>
	<div class:md:ml-11={!embedded}>
		{@render children?.()}
		<div class="pt-3">
			{#if !show_reactions}
				{#each Object.keys(grouped_reactions) as reaction}
					<div class="group relative mr-2 inline-block">
						<div class="absolute bottom-full left-0 hidden min-w-max group-hover:block">
							{@render reactionGroup(reaction)}
							<div
								class="ml-3 h-0 w-0 border-x-[8px] border-t-[10px] border-x-transparent border-t-base-400 shadow-lg"
							></div>
						</div>
						<button
							class="l btn btn-xs {grouped_reactions[reaction].has(
								store.logged_in_account?.pubkey ?? ''
							)
								? 'btn-primary'
								: 'btn-neutra'}"
							onclick={() => {
								show_reactions = !show_reactions;
							}}
						>
							{reaction}
							{grouped_reactions[reaction].size}
						</button>
					</div>
				{/each}
				{#if store.logged_in_account}
					<div class="inline-block align-middle">
						<button
							class="btn btn-ghost btn-xs p-1 opacity-40 hover:opacity-100"
							class:-ml-1={reactions.length === 0}
							aria-label="close reactions"
							onclick={() => {
								show_reactions = !show_reactions;
							}}
						>
							<svg
								viewBox="0 0 24 24"
								focusable="false"
								class="text-neutral-content"
								aria-hidden="true"
								width="14"
								height="14"
								><path
									fill="currentColor"
									d="M19.0001 13.9999V16.9999H22.0001V18.9999H18.9991L19.0001 21.9999H17.0001L16.9991 18.9999H14.0001V16.9999H17.0001V13.9999H19.0001ZM20.2426 4.75736C22.505 7.0244 22.5829 10.636 20.4795 12.992L19.06 11.574C20.3901 10.0499 20.3201 7.65987 18.827 6.1701C17.3244 4.67092 14.9076 4.60701 13.337 6.01688L12.0019 7.21524L10.6661 6.01781C9.09098 4.60597 6.67506 4.66808 5.17157 6.17157C3.68183 7.66131 3.60704 10.0473 4.97993 11.6232L13.412 20.069L11.9999 21.485L3.52138 12.993C1.41705 10.637 1.49571 7.01901 3.75736 4.75736C6.02157 2.49315 9.64519 2.41687 12.001 4.52853C14.35 2.42 17.98 2.49 20.2426 4.75736Z"
								></path></svg
							>
						</button>
					</div>
				{/if}
			{:else}
				{#each Object.keys(grouped_reactions) as reaction}
					<div class="mb-2">
						{@render reactionGroup(reaction)}
					</div>
				{/each}
				<div class="mb-2">
					<div class="mr-2 inline-block">
						{#if store.logged_in_account}
							{#each ['+', '🚀', '🤙', '🙏', '❤️', '🫂', '👀', '😂'] as reaction}
								<span class="mr-2">
									{@render addReactionButton(reaction)}
								</span>
							{/each}
						{/if}
						<button
							class="btn btn-ghost btn-xs -ml-1 p-0"
							aria-label="close reactions"
							onclick={() => {
								show_reactions = !show_reactions;
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="10"
								height="10"
								fill="currentColor"
								class="w-6 text-neutral-content opacity-40"
								viewBox="0 0 16 16"
							>
								<path
									fill-rule="evenodd"
									d="M1.5 1.5a.5.5 0 0 1 .707 0L8 7.293l5.793-5.793a.5.5 0 0 1 .707.707L8.707 8l5.793 5.793a.5.5 0 0 1-.707.707L8 8.707l-5.793 5.793a.5.5 0 0 1-.707-.707L7.293 8 1.5 2.207a.5.5 0 0 1 0-.707z"
									stroke="currentColor"
									stroke-width="1.5"
									fill="none"
								/>
							</svg>
						</button>
					</div>
				</div>
			{/if}
		</div>

		{#if show_compose && issue_or_pr_table_item}
			<div class="">
				<div class="flex">
					<div class="flex-auto"></div>
					<button
						onclick={() => {
							show_compose = false;
						}}
						class="btn btn-circle btn-ghost btn-sm right-2 top-2">✕</button
					>
				</div>
				<div>
					<ComposeReply {event} {issue_or_pr_table_item} sentFunction={() => replySent()} />
				</div>
			</div>
		{/if}
	</div>
</div>

{#if show_delete_sure_modal}
	<dialog class="modal" class:modal-open={show_delete_sure_modal}>
		<div class="modal-box relative max-w-lg text-wrap p-6">
			<div class="modal-body mb-5 text-center">
				<h3 class="text-md mb-3 font-bold">
					Send <span class="badge badge-secondary badge-lg"
						>{kindtoTextLabel(event_to_delete.kind)}</span
					> Deletion Request?
				</h3>
				<p class="mt-6 text-sm text-warning">
					warning: not all nostr relays / clients honour deletion requests
				</p>
				<input
					type="text"
					disabled={sending_deletion}
					bind:value={deletion_rationale}
					class="input-neutral input input-sm input-bordered mt-6 w-full"
					placeholder="optional deletion rationale"
				/>
			</div>
			<div class="modal-footer flex justify-between gap-4">
				<button
					class="btn btn-error flex-1"
					onclick={() => sendDeletion()}
					disabled={sending_deletion}
				>
					{#if rejected_deletion}
						Rejected by Signer
					{:else if sending_deletion}
						Signing
					{:else}
						Send Deletion Request
					{/if}
				</button>
				<button class="btn flex-1" onclick={closeModals}> Cancel </button>
			</div>
		</div>
	</dialog>
{/if}
