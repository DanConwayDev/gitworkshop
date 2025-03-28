import MentionList from './MentionList.svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { type SuggestionOptions } from '@tiptap/suggestion';
import db from '$lib/dbs/LocalDb';
import type { NostrStorage, NProfileNode } from 'nostr-editor';
import { nip19 } from 'nostr-tools';
import type { PubKeyString } from '$lib/types';
import type { Editor } from '@tiptap/core';

function getTaggedPubkeys(editor: Editor): PubKeyString[] {
	try {
		return (editor.storage.nostr as NostrStorage)
			.getNprofiles()
			.map((n) => n.pubkey as PubKeyString);
	} catch {
		return [];
	}
}

export const suggestion: (
	hint_pubkeys?: PubKeyString[]
) => Omit<
	SuggestionOptions<{ pubkey: PubKeyString; query: string }, { id: PubKeyString | null }>,
	'editor'
> = (hint_pubkeys = []) => ({
	char: '@',
	items: async ({ query, editor }) => {
		const recommended_pubkeys = [...hint_pubkeys, ...getTaggedPubkeys(editor)];
		const pubkeys = await db.pubkeys
			.filter((o) =>
				query.length > 0
					? o?.metadata?.fields?.name?.startsWith(query) ||
						o?.metadata?.fields?.display_name?.startsWith(query) ||
						o?.verified_nip05.some((nip05) => nip05.includes(query))
					: recommended_pubkeys.includes(o.pubkey)
			)
			.limit(5)
			.keys();
		return pubkeys.map((pubkey) => ({ pubkey: pubkey as PubKeyString, query }));
	},
	render: () => {
		let wrapper: HTMLDivElement;
		let componentProps: ComponentProps<typeof MentionList> = $state(null!);
		let component: typeof MentionList;

		return {
			onStart: (props) => {
				// ...
				const { editor } = props;
				wrapper = document.createElement('div');
				editor.view.dom.parentNode?.appendChild(wrapper);
				componentProps = {
					items: props.items,
					callback: (item) => {
						if (item) {
							const pubkey = $state.snapshot(item.pubkey);
							props.editor
								.chain()
								.focus()
								.deleteRange({
									from: props.range.from,
									to: props.range.to + item.query.length
								})
								.insertContent({
									type: 'nprofile',
									attrs: {
										type: 'nprofile',
										pubkey,
										bech32: nip19.nprofileEncode({
											pubkey,
											relays: []
										}),
										relays: []
									}
								} as NProfileNode)
								.run();
						}
						return true;
					}
				};

				component = mount(MentionList, {
					target: wrapper,
					props: componentProps
				});

				// ...
			},
			onKeyDown: (props) => {
				if (props.event.key === 'Escape') {
					unmount(component);
					wrapper.remove();

					return true;
				}
				return component.onKeyDown(props.event);
			},
			onUpdate: (props) => {
				componentProps.items = props.items;
			},
			// ...
			onExit: (props) => {
				wrapper.remove();
			}
		};
	}
});

export default suggestion;
