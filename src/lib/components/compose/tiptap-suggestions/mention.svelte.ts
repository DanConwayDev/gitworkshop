import MentionList from './MentionList.svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { type SuggestionOptions } from '@tiptap/suggestion';
import db from '$lib/dbs/LocalDb';

export const suggestion: () => Omit<
	SuggestionOptions<
		string, // <-- Item type
		{
			// <-- Callback args / Command props
			id: string | null;
		}
	>,
	'editor'
> = () => ({
	// ...
	items: async ({ query }) => {
		return await db.pubkeys
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
		let component: MentionList;

		return {
			onStart: (props) => {
				// ...
				const { editor } = props;
				wrapper = document.createElement('div');
				editor.view.dom.parentNode?.appendChild(wrapper);
				componentProps = {
					items: props.items,
					callback: (item) => {
						props.command({ id: item });
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
