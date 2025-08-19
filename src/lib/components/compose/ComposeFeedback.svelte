<script lang="ts">
	import { onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension, type NostrStorage } from 'nostr-editor';
	import MentionEditor from '$lib/components/content-tree/MentionEditor.svelte';
	import EmbeddedEventEditor from '../content-tree/EmbeddedEventEditor.svelte';
	import store from '$lib/store.svelte';
	import accounts_manager from '$lib/accounts';
	import { FeedbackKind } from '$lib/kinds';
	import { unixNow } from 'applesauce-core/helpers';
	import { SimpleSigner } from 'applesauce-signers';
	import { icons_misc } from '$lib/icons';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { page } from '$app/stores';

	let { done }: { done: () => void } = $props();

	let anon_force = $state(false);

	let submit_attempted = $state(false);
	let submitting = $state(false);
	let signed = $state(false);
	let sent = $state(false);
	let rejected_by_signer = $state(false);

	const submit = async () => {
		if (content.length < 10) {
			submit_attempted = true;
			return;
		}
		submit_attempted = false;

		$editor.setEditable(false);
		submitting = true;
		let tags: string[][] = [];
		(
			[
				['alt', `gitworkshop.dev app feedback`],
				[
					'a',
					'30617:a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d:gitworkshop',
					'wss://nos.lol'
				],
				['p', 'a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d', 'wss://nos.lol'],
				['n', 'gitworkshop.dev'],
				['expiration', (unixNow() + 60 * 60 * 24 * 30).toString()],
				['r', $page.url],
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
			let signer = anon_force
				? new SimpleSigner()
				: (accounts_manager.getActive() ?? new SimpleSigner());
			let event = await signer.signEvent(
				$state.snapshot({
					kind: FeedbackKind,
					created_at: unixNow(),
					tags: $state.snapshot(tags),
					content: `${$state.snapshot(content)}\n\n---\nsent from: ${$page.url}`
				})
			);
			if (event) {
				signed = true;
				query_centre.publishEvent(event);
				sent = true;
				setTimeout(() => done(), 1000);
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

	onMount(() => {
		editor = createEditor({
			extensions: [
				StarterKit,
				NostrExtension.configure({
					extend: {
						nprofile: { addNodeView: () => SvelteNodeViewRenderer(MentionEditor) },
						nevent: { addNodeView: () => SvelteNodeViewRenderer(EmbeddedEventEditor) },
						naddr: { addNodeView: () => SvelteNodeViewRenderer(EmbeddedEventEditor) }
					}
				})
			],
			autofocus: true
		});
	});
</script>

{#if sent}
	<div class="py-9 text-center">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="fill-success mx-auto mb-3 h-16 w-16"
		>
			{#each icons_misc.complete as d}
				<path {d} />
			{/each}
		</svg>
		<div>Feedback Sent</div>
	</div>
{:else}
	<div class="flex">
		<div class="grow">
			<label class="form-control w-full">
				<div class="prose grow pt-2">
					<div
						class=" border-neutral w-full rounded-md border"
						class:focus-within:ring-2={!submitting}
						class:focus-within:ring-primary={!submitting}
						class:focus-within:focus:outline-none={!submitting}
						class:border-base-300={submitting}
					>
						{#if editor}<EditorContent editor={$editor} class="tiptap-editor p-2" />{/if}
					</div>
				</div>
			</label>

			<div class="mt-2 flex items-center">
				{#if !!store.logged_in_account}
					<div class="mr-3 flex items-center align-bottom text-xs">
						<input
							type="checkbox"
							id="feedback-checkbox"
							class="checkbox checkbox-xs"
							bind:checked={anon_force}
						/>
						<label for="feedback-checkbox" class="ml-2">Anonymous</label>
					</div>
				{/if}

				<div class="grow"></div>
				{#if submit_attempted && content.length < 10}
					<div class="text-warning pr-3 align-middle text-sm">
						feedback must be at least 10 characters
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
