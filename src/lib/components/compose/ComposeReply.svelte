<script lang="ts">
	import { onMount } from 'svelte';
	import type { FormEventHandler } from 'svelte/elements';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension, type NostrStorage } from 'nostr-editor';
	import MentionEditor from '$lib/components/content-tree/MentionEditor.svelte';
	import { Markdown } from 'tiptap-markdown';
	import Mention from '@tiptap/extension-mention';
	import mention from './tiptap-suggestions/mention.svelte';
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
	import { SimpleSigner } from 'applesauce-signers';
	import { stringToDocTree } from '$lib/doc_tree';

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

	let anon_force = $state(false);
	let show_login_modal = $state(false);
	let submitting = $state(false);
	let signed = $state(false);
	let rejected_by_signer = $state(false);
	let raw_mode = $state(false);
	let raw_content = $state('');

	const submit = async () => {
		if (!anon_force && !store.logged_in_account) {
			show_login_modal = true;
			return;
		}
		const signer = anon_force
			? new SimpleSigner()
			: (accounts_manager.getActive() ?? new SimpleSigner());

		if (raw_mode) {
			restartEditor(raw_content);
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
			let reply = await signer.signEvent(
				$state.snapshot({
					kind: $state.snapshot(kind),
					created_at: unixNow(),
					tags: $state.snapshot(tags),
					content: raw_mode ? $state.snapshot(raw_content) : $state.snapshot(content)
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
	let content = $derived($editor ? $editor.storage.markdown.getMarkdown() : '');
	let person_tags = $state(event.tags.filter((t) => t[0] && t[0] === 'p'));
	let editor_tags = $derived(editor ? ($editor.storage.nostr as NostrStorage).getEditorTags() : []);
	let raw_mode_option = $derived(
		content.includes('`') || content.includes('#') || content.includes('nostr:')
	);
	// svelte-ignore non_reactive_update
	let textareaElement: HTMLTextAreaElement;

	let adjustTextareaHeight: FormEventHandler<HTMLTextAreaElement> = (event) => {
		const textarea = event.target as HTMLTextAreaElement;
		if (textarea) {
			textarea.style.height = 'auto'; // Reset height to auto to calculate the new height
			textarea.style.height = `${textarea.scrollHeight}px`; // Set height to scrollHeight
		}
	};

	// TODO querycentre.ensureRecentPubkeyRelays() for each tagged user so sends to correct relays

	let restartEditor = (starter_content?: string) => {
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
					link: { autolink: false } // needed for markdown links
				}),
				Mention.configure({
					suggestion: mention([event.pubkey, ...person_tags.map((t) => t[1])])
				})
			],
			content: starter_content ? stringToDocTree(starter_content) : undefined,
			autofocus
		});
	};
	onMount(() => {
		restartEditor();
	});
</script>

<div class="flex pt-5">
	<div class="mt-0 flex-none px-3">
		<UserHeader avatar_only={true} user={store.logged_in_account?.pubkey} />
	</div>
	<div class="prose grow pt-2">
		{#if !raw_mode && editor}
			<div
				class=" border-primary w-full rounded-md border"
				class:focus-within:ring-2={!submitting}
				class:focus-within:ring-primary={!submitting}
				class:focus-within:focus:outline-none={!submitting}
				class:border-base-300={submitting}
			>
				<EditorContent editor={$editor} class="tiptap-editor p-2" />
			</div>
		{:else}
			<textarea
				class="border-primary w-full resize-none overflow-hidden rounded-md border p-2"
				class:focus-within:ring-2={!submitting}
				class:focus-within:ring-primary={!submitting}
				class:focus-within:focus:outline-none={!submitting}
				class:border-base-300={submitting}
				bind:value={raw_content}
				disabled={submitting}
				oninput={adjustTextareaHeight}
				onfocus={adjustTextareaHeight}
				bind:this={textareaElement}
			></textarea>
		{/if}
		<div class="mt-4 flex">
			{#if !store.logged_in_account}
				<div class="mr-3 flex items-center align-bottom text-xs">
					<input
						type="checkbox"
						id="feedback-checkbox"
						class="checkbox checkbox-xs p-1"
						bind:checked={anon_force}
					/>
					<label for="feedback-checkbox" class="p-2">Anonymous</label>
				</div>
			{/if}
			<div class="flex-auto"></div>
			{#if raw_mode_option}
				<div class="tabs tabs-box tabs-xs mr-4">
					<button
						class="tab"
						class:tab-active={raw_mode}
						class:cursor-default={raw_mode}
						onclick={() => {
							if (!raw_mode) {
								raw_content = $state.snapshot(content);
								raw_mode = true;
								setTimeout(() => {
									textareaElement?.focus();
								}, 1);
							}
						}}><span class="text-xs">Plain Text</span></button
					>
					<button
						class="tab"
						class:tab-active={!raw_mode}
						class:cursor-default={!raw_mode}
						onclick={() => {
							if (raw_mode) {
								// restarting the editor to ensure previously tagged nostr elements dont find their way into the tags
								restartEditor(raw_content);
								$editor.commands.focus(
									99999 // focus at end
								);
								raw_mode = false;
							}
						}}><span class="text-xs">Editor</span></button
					>
				</div>
			{/if}
			<button
				onclick={submit}
				disabled={submitting || (raw_mode ? raw_content.length === 0 : content.length === 0)}
				class="align-right btn btn-primary btn-sm align-bottom"
			>
				{#if submitting}
					{#if rejected_by_signer}
						Rejected by Signer
					{:else if !signed}
						Signing
					{:else}
						Sending
					{/if}
				{:else if !anon_force && !store.logged_in_account}
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
