<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import { eventToNip19 } from '$lib/utils';
	import CopyField from '../CopyField.svelte';
	import { onMount, type Snippet } from 'svelte';
	import store from '$lib/store.svelte';
	import ComposeReply from '../compose/ComposeReply.svelte';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';

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
	let show_raw_json_modal = $state(false);
	let show_share_modal = $state(false);
	let modal_open = $derived(show_raw_json_modal || show_share_modal);
	const replySent = () => {
		show_compose = false;
	};
	const closeModals = () => {
		show_raw_json_modal = false;
		show_share_modal = false;
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
</script>

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
	<div class="flex">
		<div class="flex-auto">
			<UserHeader user={event.pubkey} in_event_header={true} />
		</div>
		<span class="m-auto text-xs"><FromNow unix_seconds={event.created_at} /></span>
		<div class="m-auto ml-2">
			{#if event}
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
		{#if reactions.length > 0}
			<div class="pt-2">
				{#if !show_reactions}
					{#each Object.keys(grouped_reactions) as reaction}
						<button
							class="btn btn-neutral btn-xs"
							onclick={() => {
								show_reactions = !show_reactions;
							}}
						>
							{reaction}
							{grouped_reactions[reaction].size}
						</button>
					{/each}
				{:else}
					{#each reactions as reaction}
						<button
							class="btn btn-neutral btn-sm"
							onclick={() => {
								show_reactions = !show_reactions;
							}}
						>
							{reaction.content}
							<div class="badge">
								<UserHeader user={reaction.pubkey} link_to_profile={false} inline size="xs" />
							</div>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</div>
