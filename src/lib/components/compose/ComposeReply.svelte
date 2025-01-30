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
	import { reply_kind } from '$lib/kinds';
	import { unixNow } from 'applesauce-core/helpers';
	import { getStandardnip10ReplyTags } from '$lib/thread_tree';
	import type { IssueOrPRTableItem } from '$lib/types';

	let {
		event,
		issue_or_pr_table_item,
		sentFunction
	}: {
		event: NostrEvent;
		issue_or_pr_table_item: IssueOrPRTableItem;
		sentFunction: () => void;
	} = $props();

	let signing = $state(false);
	let submitting = $state(false);

	const submit = async () => {
		$editor.setEditable(false);
		signing = true;
		let table_item = $state.snapshot(issue_or_pr_table_item);
		let tags: string[][] = [];
		[
			...getStandardnip10ReplyTags(event, table_item),
			// TODO add relay hints to p and a tags from local_db
			...person_tags,
			['p', event.pubkey],
			...editor_tags,
			...table_item.repos.map((a) => ['a', a])
		].forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[1] === t[1]))
				tags.push(t[0] === 't' ? ['t', t[1].slice(1).toLocaleLowerCase()] : t);
		});
		let reply = await accounts_manager.getActive()?.signEvent(
			$state.snapshot({
				kind: reply_kind,
				created_at: unixNow(),
				tags: $state.snapshot(tags),
				content: $state.snapshot(content)
			})
		);
		signing = false;
		submitting = true;
		// TODO fetched this relay info whilst composing
		let for_outbox = {
			event: reply,
			relay_groups: [
				{ type: 'outbox', relays: [] },
				{ type: 'tagged_user_inbox', npub: '', marker: 'root', relays: [] },
				{ type: 'tagged_user_inbox', npub: '', marker: 'reply', relays: [] },
				{ type: 'tagged_user_inbox', npub: '', relays: [] },
				{ type: 'repo', a_ref: '', relays: [] },
				{ type: 'repo', a_ref: '', relays: [] }
			]
		};
		// TODO add to outbox queue
		// TODO unless in offline mode, wait fot it to be recieved by at least 1 relay
		// sentFunction();
	};

	let editor = $state() as Readable<Editor>;
	let content = $derived($editor ? $editor.getText() : '');
	let person_tags = $state(event.tags.filter((t) => t[0] && t[0] === 'p'));
	let editor_tags = $derived(editor ? ($editor.storage.nostr as NostrStorage).getEditorTags() : []);
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
			]
		});
	});
</script>

<div class="flex pt-5">
	<div class="mt-0 flex-none px-3">
		<UserHeader avatar_only={true} user={store.logged_in_account?.pubkey} />
	</div>
	<div class="flex-grow pt-2">
		{#if !submitting}
			<div class="prose w-full border-2 border-primary">
				{#if editor}<EditorContent editor={$editor} />{/if}
			</div>
		{/if}
		<div class="flex">
			<div class="flex-auto"></div>
			<button
				onclick={submit}
				disabled={submitting || signing || content.length === 0}
				class="align-right btn btn-primary btn-sm mt-2 align-bottom"
			>
				{#if signing}
					Signing
				{:else if submitting}
					TODO Sending
				{:else if !store.logged_in_account}
					Login before Sending
				{:else}
					Send
				{/if}
			</button>
		</div>
	</div>
</div>
