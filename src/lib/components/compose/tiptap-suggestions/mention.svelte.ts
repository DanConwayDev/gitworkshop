import MentionList from './MentionList.svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { type SuggestionOptions } from '@tiptap/suggestion';
import db from '$lib/dbs/LocalDb';
import type { NProfileNode } from 'nostr-editor';
import { nip19 } from 'nostr-tools';
import type { PubKeyString } from '$lib/types';

export const suggestion: () => Omit<
	SuggestionOptions<{ pubkey: PubKeyString; query: string }, { id: PubKeyString | null }>,
	'editor'
> = () => ({
	// ...
	items: async ({ query }) => {
		cont pubkeys = await db.pubkeys
			.filter(
				(o) =>
					o?.metadata?.fields?.name?.startsWith(query) ||
					o?.metadata?.fields?.display_name?.startsWith(query) ||
					o?.verified_nip05.some((nip05) => nip05.includes(query))
			)
			.limit(5)
			.keys();
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
							const pubkey = $state.snapshot(item);
							console.log(props.query.length);
							console.log(props.text);

							props.editor
								.chain()
								.focus()
								.deleteRange({
									from: props.range.from - props.query.length,
									to: props.range.to
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
					return true;
				}
				return component.onKeyDown(props.event);
			},
			onUpdate: (props) => {
				componentProps.items = props.items;
			},
			// ...
			onExit: (props) => {
				// ...

				unmount(component); // <-- unmount after use
				wrapper.remove();
			}
		};
	}
});

export default suggestion;
