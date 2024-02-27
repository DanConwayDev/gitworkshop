<script lang="ts">
  import EventCard from './EventCard.svelte'
  import ThreadWrapper from '$lib/components/events/ThreadWrapper.svelte'
  import type { ThreadTreeNode } from '$lib/components/events/type'

  export let tree: ThreadTreeNode
  export let type: 'proposal' | 'issue' = 'proposal'
</script>

<EventCard {type} event={tree.event} />
<ThreadWrapper>
  {#each tree.child_nodes as layer1}
    <EventCard {type} event={layer1.event} />
    <ThreadWrapper>
      {#each layer1.child_nodes as layer2}
        <EventCard {type} event={layer2.event} />
        <ThreadWrapper>
          {#each layer2.child_nodes as layer3}
            <EventCard {type} event={layer3.event} />
            <ThreadWrapper>
              {#each layer3.child_nodes as layer4}
                <EventCard {type} event={layer4.event} />
                <ThreadWrapper>
                  {#each layer4.child_nodes as layer5}
                    <EventCard {type} event={layer5.event} />
                    <ThreadWrapper>
                      {#each layer5.child_nodes as layer6}
                        <EventCard {type} event={layer6.event} />
                        <ThreadWrapper>
                          {#each layer6.child_nodes as layer7}
                            <EventCard {type} event={layer7.event} />
                            <ThreadWrapper>
                              {#each layer7.child_nodes as layer8}
                                <EventCard {type} event={layer8.event} />
                                <ThreadWrapper>
                                  {#each layer8.child_nodes as layer9}
                                    <EventCard {type} event={layer9.event} />
                                    <ThreadWrapper>
                                      {#each layer9.child_nodes as layer10}
                                        <EventCard
                                          {type}
                                          event={layer10.event}
                                        />
                                        <ThreadWrapper>
                                          {#each layer10.child_nodes as layer11}
                                            <EventCard
                                              {type}
                                              event={layer11.event}
                                            />
                                            <ThreadWrapper>
                                              {#each layer11.child_nodes as layer12}
                                                <EventCard
                                                  {type}
                                                  event={layer12.event}
                                                />
                                                <ThreadWrapper>
                                                  {#each layer12.child_nodes as layer13}
                                                    <EventCard
                                                      {type}
                                                      event={layer13.event}
                                                    />
                                                    <ThreadWrapper>
                                                      {#each layer13.child_nodes as layer14}
                                                        <EventCard
                                                          {type}
                                                          event={layer14.event}
                                                        />
                                                        <ThreadWrapper>
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
</ThreadWrapper>
