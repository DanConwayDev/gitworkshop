<script lang="ts">
	import { onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension, type ContentSchema } from 'nostr-editor';
	import MentionEditor from '$lib/components/content-tree/MentionEditor.svelte';
	import { Markdown } from 'tiptap-markdown';
	import ContentTree from '../content-tree/ContentTree.svelte';

	let {
		content = ''
	}: {
		content: string;
	} = $props();

	let editor = $state() as Readable<Editor>;
	let json = $derived($editor ? $editor.getJSON() : { type: 'doc' }) as ContentSchema;
	onMount(() => {
		editor = createEditor({
			extensions: [
				StarterKit,
				Markdown.configure({
					transformCopiedText: true,
					transformPastedText: true
				}),
				NostrExtension.configure({
					extend: { nprofile: { addNodeView: () => SvelteNodeViewRenderer(MentionEditor) } },
					link: { autolink: true } // needed for markdown links
				})
			],
			content
		});
	});
</script>

<div class="prose">
	<EditorContent editor={$editor} />
</div>

<div>{JSON.stringify(json ?? '')}</div>

<ContentTree node={json} />
