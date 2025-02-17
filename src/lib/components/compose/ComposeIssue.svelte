<script lang="ts">
	import { onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension, type NostrStorage } from 'nostr-editor';
	import MentionEditor from '$lib/components/content-tree/MentionEditor.svelte';
	import { Markdown } from 'tiptap-markdown';
	import EmbeddedEventEditor from '../content-tree/EmbeddedEventEditor.svelte';
	import store from '$lib/store.svelte';
	import accounts_manager from '$lib/accounts';
	import { IssueKind } from '$lib/kinds';
	import { unixNow } from 'applesauce-core/helpers';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { goto } from '$app/navigation';
	import { nip19 } from 'nostr-tools';
	import { repoTableItemDefaults, type RepoRef } from '$lib/types';
	import { repoToMaintainerRepoRefs } from '$lib/repos';
	import LoginModal from '../LoginModal.svelte';

	let { a_ref }: { a_ref: RepoRef } = $props();

	let repo_query = $derived(query_centre.fetchRepo(a_ref));
	let repo = $derived(repo_query.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined));

	let repo_refs = $derived(repo ? repoToMaintainerRepoRefs(repo) : new Set());

	let title = $state('');

	let show_login_modal = $state(false);
	let submit_attempted = $state(false);
	let submitting = $state(false);
	let signed = $state(false);
	let rejected_by_signer = $state(false);

	const submit = async () => {
		if (!store.logged_in_account) {
			show_login_modal = true;
			return;
		}
		if (title.length < 10) {
			submit_attempted = true;
			return;
		}
		submit_attempted = false;

		$editor.setEditable(false);
		submitting = true;
		let tags: string[][] = [];
		(
			[
				['subject', title],
				['alt', `git repository issue: ${title}`],
				...[...repo_refs].map((a_ref) => ['a', a_ref]),
				// TODO add relay hints to tags from local_db
				...editor_tags
			] as string[][]
		).forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[1] === t[1])) tags.push(t);
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
			let event = await accounts_manager.getActive()?.signEvent(
				$state.snapshot({
					kind: IssueKind,
					created_at: unixNow(),
					tags: $state.snapshot(tags),
					content: $state.snapshot(content)
				})
			);
			if (event) {
				signed = true;
				query_centre.publishEvent(event);
				const nevent = nip19.neventEncode({
					id: event.id
				});
				goto(`./${nevent}`);
			} else {
				rejectedBySigner();
			}
		} catch {
			rejectedBySigner();
		}
	};

	let editor = $state() as Readable<Editor>;
	let content = $derived($editor ? $editor.getText() : '');
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
			]
		});
	});
</script>

<div class="flex">
	<div class="flex-grow">
		<label class="form-control w-full">
			<div class="label">
				<span class="label-text text-sm">Title</span>
			</div>
			<input
				type="text"
				bind:value={title}
				class="input-neutral input input-sm input-bordered mb-3 w-full"
				class:border-warning={submit_attempted && title.length < 10}
				placeholder="title"
			/>
			{#if submit_attempted && title.length < 10}
				<div class="pr-3 align-middle text-sm text-warning">
					title must be at least 10 characters
				</div>
			{/if}
		</label>
		<label class="form-control w-full">
			<div class="label">
				<span class="label-textarea text-sm">Description</span>
			</div>
			<div class="prose flex-grow pt-2">
				<div
					class=" w-full rounded-md border border-neutral"
					class:focus-within:ring-2={!submitting}
					class:focus-within:ring-neutral={!submitting}
					class:focus-within:focus:outline-none={!submitting}
					class:border-base-300={submitting}
				>
					{#if editor}<EditorContent editor={$editor} class="tiptap-editor p-2" />{/if}
				</div>
			</div>
		</label>

		<div class="mt-2 flex items-center">
			<div class="flex-auto"></div>
			{#if submit_attempted && title.length < 10}
				<div class="pr-3 align-middle text-sm text-warning">
					title must be at least 10 characters
				</div>
			{/if}
			<button
				onclick={submit}
				disabled={submitting}
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
{#if false}
	<div>sent going to issue!</div>
{/if}

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
