<script lang="ts">
	import type { ThreadTreeNode } from '$lib/types';
	import EventCard from './EventCard.svelte';
	import ThreadWrapper from './ThreadWrapper.svelte';

	let {
		type,
		tree,
		show_compose
	}: {
		type: 'issue' | 'pr';
		tree: ThreadTreeNode;
		show_compose: boolean;
	} = $props();
	const countReplies = (tree: ThreadTreeNode, starting: number = 0): number => {
		return (
			tree.child_nodes.length + tree.child_nodes.reduce((a, c) => a + countReplies(c), starting)
		);
	};
</script>

{#if tree}
	<EventCard {type} event={tree.event} />
	<ThreadWrapper num_replies={countReplies(tree)}>
		{#each tree.child_nodes as layer1}
			<EventCard {type} event={layer1.event} />
			<ThreadWrapper num_replies={countReplies(layer1)}>
				{#each layer1.child_nodes as layer2}
					<EventCard {type} event={layer2.event} />
					<ThreadWrapper num_replies={countReplies(layer2)}>
						{#each layer2.child_nodes as layer3}
							<EventCard {type} event={layer3.event} />
							<ThreadWrapper num_replies={countReplies(layer3)}>
								{#each layer3.child_nodes as layer4}
									<EventCard {type} event={layer4.event} />
									<ThreadWrapper num_replies={countReplies(layer4)}>
										{#each layer4.child_nodes as layer5}
											<EventCard {type} event={layer5.event} />
											<ThreadWrapper num_replies={countReplies(layer5)}>
												{#each layer5.child_nodes as layer6}
													<EventCard {type} event={layer6.event} />
													<ThreadWrapper num_replies={countReplies(layer6)}>
														{#each layer6.child_nodes as layer7}
															<EventCard {type} event={layer7.event} />
															<ThreadWrapper num_replies={countReplies(layer7)}>
																{#each layer7.child_nodes as layer8}
																	<EventCard {type} event={layer8.event} />
																	<ThreadWrapper num_replies={countReplies(layer8)}>
																		{#each layer8.child_nodes as layer9}
																			<EventCard {type} event={layer9.event} />
																			<ThreadWrapper num_replies={countReplies(layer9)}>
																				{#each layer9.child_nodes as layer10}
																					<EventCard {type} event={layer10.event} />
																					<ThreadWrapper num_replies={countReplies(layer10)}>
																						{#each layer10.child_nodes as layer11}
																							<EventCard {type} event={layer11.event} />
																							<ThreadWrapper num_replies={countReplies(layer11)}>
																								{#each layer11.child_nodes as layer12}
																									<EventCard {type} event={layer12.event} />
																									<ThreadWrapper
																										num_replies={countReplies(layer12)}
																									>
																										{#each layer12.child_nodes as layer13}
																											<EventCard {type} event={layer13.event} />
																											<ThreadWrapper
																												num_replies={countReplies(layer13)}
																											>
																												{#each layer13.child_nodes as layer14}
																													<EventCard {type} event={layer14.event} />
																													<ThreadWrapper
																														num_replies={countReplies(layer14)}
																													>
																														{#each layer14.child_nodes as layer15}
																															<EventCard
																																{type}
																																event={layer15.event}
																															/>
																														{/each}
																													</ThreadWrapper>
																												{/each}
																											</ThreadWrapper>
																										{/each}
																									</ThreadWrapper>
																								{/each}
																							</ThreadWrapper>
																						{/each}
																					</ThreadWrapper>
																				{/each}
																			</ThreadWrapper>
																		{/each}
																	</ThreadWrapper>
																{/each}
															</ThreadWrapper>
														{/each}
													</ThreadWrapper>
												{/each}
											</ThreadWrapper>
										{/each}
									</ThreadWrapper>
								{/each}
							</ThreadWrapper>
						{/each}
					</ThreadWrapper>
				{/each}
			</ThreadWrapper>
		{/each}
		{#if show_compose}
			<!-- <ComposeReply {type} event={tree.event} /> -->
		{/if}
	</ThreadWrapper>
{/if}
