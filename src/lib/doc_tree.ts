import { type NostrEvent } from 'nostr-tools';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { NostrExtension, type ContentSchema } from 'nostr-editor';

const editor = new Editor({
	extensions: [
		StarterKit,
		Markdown.configure({ breaks: true }),
		NostrExtension.configure({ link: { autolink: false } })
	]
});

const editor_with_links = new Editor({
	extensions: [
		StarterKit,
		Markdown.configure({ breaks: true }),
		NostrExtension.configure({ link: { autolink: true } })
	]
});

export const nostrEventToDocTree = (
	event: NostrEvent,
	markdown_links: boolean = false
): ContentSchema => {
	const e = markdown_links ? editor_with_links : editor;
	e.commands.setEventContent(event);
	return e.getJSON() as ContentSchema;
};

export const stringToDocTree = (s: string, markdown_links: boolean = false): ContentSchema => {
	// setContent doesnt work anymore(?) with nostr-editor so we need to use setEventContent
	return nostrEventToDocTree(
		{ kind: 1, content: s, tags: [] } as unknown as NostrEvent,
		markdown_links
	);
};
