import { type NostrEvent } from 'nostr-tools';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { NostrExtension, type ContentSchema } from 'nostr-editor';

const editor = new Editor({
	extensions: [
		StarterKit,
		Markdown.configure({ breaks: true }),
		NostrExtension.configure({ link: { autolink: true } })
	]
});

export const nostrEventToDocTree = (event: NostrEvent): ContentSchema => {
	editor.commands.setEventContent(event);
	return editor.getJSON() as ContentSchema;
};

export const stringToDocTree = (s: string): ContentSchema => {
	editor.commands.setContent(s);
	return editor.getJSON() as ContentSchema;
};
