<script lang="ts">
	import { onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension, type NostrStorage } from 'nostr-editor';
	import MentionEditor from '$lib/components/content-tree/MentionEditor.svelte';
	import { Markdown } from 'tiptap-markdown';
	import EmbeddedEventEditor from '../content-tree/EmbeddedEventEditor.svelte';
	import type { NostrEvent } from 'nostr-tools';
	import UserHeader from '../user/UserHeader.svelte';
	import store from '$lib/store.svelte';
	import accounts_manager from '$lib/accounts';
	import { LegacyGitReplyKind, ReplyKind } from '$lib/kinds';
	import { unixNow } from 'applesauce-core/helpers';
	import type { IssueOrPRTableItem } from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import LoginModal from '../LoginModal.svelte';
	import { ShortTextNote } from 'nostr-tools/kinds';
	import { getStandardnip10ReplyTags, getStandardnip22ReplyTags } from '$lib/utils';

	let {
		event,
		issue_or_pr_table_item,
		sentFunction,
		autofocus = true
	}: {
		event: NostrEvent;
		issue_or_pr_table_item: IssueOrPRTableItem;
		sentFunction: () => void;
		autofocus?: boolean;
	} = $props();

	let show_login_modal = $state(false);
	let submitting = $state(false);
	let signed = $state(false);
	let rejected_by_signer = $state(false);

	const submit = async () => {
		if (!store.logged_in_account) {
			show_login_modal = true;
			return;
		}

		$editor.setEditable(false);
		submitting = true;
		let table_item = $state.snapshot(issue_or_pr_table_item);
		let tags: string[][] = [];
		const kind = [LegacyGitReplyKind, ShortTextNote].includes(event.kind)
			? ShortTextNote
			: ReplyKind;
		[
			...(kind === ShortTextNote
				? getStandardnip10ReplyTags(event, table_item)
				: getStandardnip22ReplyTags(event, table_item)),
			// TODO add relay hints to p and a tags from local_db
			...person_tags,
			['p', event.pubkey],
			...editor_tags
		].forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[0] === t[0] && e[1] === t[1]))
				tags.push(t);
		});
		const rejectedBySigner = () => {
			rejected_by_signer = true;
			setTimeout(() => {
				$editor.setEditable(true);
				submitting = false;
				signed = false;
			}, 2000);
		};
		try {
			let reply = await accounts_manager.getActive()?.signEvent(
				$state.snapshot({
					kind: $state.snapshot(kind),
					created_at: unixNow(),
					tags: $state.snapshot(tags),
					content: $state.snapshot(content)
				})
			);
			if (reply) {
				signed = true;
				query_centre.publishEvent(reply);
				sentFunction();
			} else {
				rejectedBySigner();
			}
		} catch {
			rejectedBySigner();
		}
	};

	let editor = $state() as Readable<Editor>;
	let content = $derived($editor ? $editor.getText() : '');
	let person_tags = $state(event.tags.filter((t) => t[0] && t[0] === 'p'));
	let editor_tags = $derived(editor ? ($editor.storage.nostr as NostrStorage).getEditorTags() : []);

	// TODO querycentre.ensureRecentPubkeyRelays() for each tagged user so sends to correct relays

	onMount(() => {
		editor = createEditor({
			extensions: [
				StarterKit,
				Markdown.configure({
					transformCopiedText: true,
					transformPastedText: true
				}),
				NostrExtension.configure({
					extend: {
						nprofile: { addNodeView: () => SvelteNodeViewRenderer(MentionEditor) },
						nevent: { addNodeView: () => SvelteNodeViewRenderer(EmbeddedEventEditor) },
						naddr: { addNodeView: () => SvelteNodeViewRenderer(EmbeddedEventEditor) }
					},
					link: { autolink: true } // needed for markdown links
				})
			],
			autofocus
		});
	});
</script>

<div class="flex pt-5">
	<div class="mt-0 flex-none px-3">
		<UserHeader avatar_only={true} user={store.logged_in_account?.pubkey} />
	</div>
	<div class="prose flex-grow pt-2">
		<div
			class=" w-full rounded-md border border-primary"
			class:focus-within:ring-2={!submitting}
			class:focus-within:ring-primary={!submitting}
			class:focus-within:focus:outline-none={!submitting}
			class:border-base-300={submitting}
		>
			{#if editor}<EditorContent editor={$editor} class="tiptap-editor p-2" />{/if}
		</div>
		<div class="flex">
			<div class="flex-auto"></div>
			<button
				onclick={submit}
				disabled={submitting || content.length === 0}
				class="align-right btn btn-primary btn-sm mt-2 align-bottom"
			>
				{#if submitting}
					{#if rejected_by_signer}
						Rejected by Signer
					{:else if !signed}
						Signing
					{:else}
						Sending
					{/if}
				{:else if !store.logged_in_account}
					Login before Sending
				{:else}
					Send
				{/if}
			</button>
		</div>
	</div>
</div>

{#if show_login_modal}
	<LoginModal
		done={() => {
			show_login_modal = false;
		}}
	/>
{/if}

<style>
	:global(.prose .tiptap-editor p:first-child) {
		margin-top: 0;
	}
	:global(.prose .tiptap-editor p:last-child) {
		margin-bottom: 0;
	}
	:global(.tiptap-editor .ProseMirror) {
		border: none; /* Remove border */
		outline: none; /* Remove default outline */
		box-shadow: none; /* Remove any box shadow */
		padding: 0; /* Reset padding if needed */
	}
</style>
