<script lang="ts">
	import { onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import { createEditor, Editor, EditorContent, SvelteNodeViewRenderer } from 'svelte-tiptap';
	import StarterKit from '@tiptap/starter-kit';
	import { NostrExtension } from 'nostr-editor';
	import Mention from '$lib/components/compose/Mention.svelte';
	import { Markdown } from 'tiptap-markdown';

	let {
		content = ''
	}: {
		content: string;
	} = $props();

	let editor = $state() as Readable<Editor>;
	let json = $derived($editor ? $editor.getJSON() : {});
	onMount(() => {
		editor = createEditor({
			extensions: [
				StarterKit,
				Markdown.configure({
					transformCopiedText: true,
					transformPastedText: true
				}),
				NostrExtension.configure({
					extend: { nprofile: { addNodeView: () => SvelteNodeViewRenderer(Mention) } },
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
