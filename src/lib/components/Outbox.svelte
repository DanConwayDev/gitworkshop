<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import { kindtoTextLabel } from '$lib/kinds';
	import type { EventIdString } from '$lib/types';
	import FromNow from './FromNow.svelte';
	import UserHeader from './user/UserHeader.svelte';
	import { GitRepositoryAnnouncement } from '$lib/kind_labels';
	import Container from './Container.svelte';

	let outbox_query = liveQueryState(() => {
		return db.outbox.toArray();
	});
	let outbox = $derived(
		[...(outbox_query.current ?? [])].sort((a, b) => b.event.created_at - a.event.created_at) ?? []
	);
	let filter: 'recent' | 'broadcast issues' | 'not broadcast' = $state('recent');
	let broadcast_issues = $derived(outbox.filter((o) => !o.broadly_sent));
	let not_broadcast = $derived(outbox.filter((o) => o.relay_logs.every((l) => !l.success)));
	let filtered = $derived(
		outbox.filter((o) => {
			if (filter === 'recent') return true;
			if (filter === 'broadcast issues') return !o.broadly_sent;
			return o.relay_logs.every((l) => !l.success);
		})
	);
	let selected: EventIdString | undefined = $state(undefined);
</script>

<div class="h-full bg-base-400">
	<Container>
		<div class="flex items-center border-b border-primary pb-2">
			<div class="prose flex-grow">
				<h3>Outbox</h3>
			</div>
			<div class="flex space-x-2">
				<button
					class="btn btn-xs"
					class:btn-primary={filter === 'recent'}
					onclick={() => {
						filter = 'recent';
					}}>Recent</button
				>
				<div class="indicator">
					{#if broadcast_issues.length > 0}<span
							class="text-xsm badge indicator-item badge-secondary badge-sm indicator-top"
							>{broadcast_issues.length}</span
						>{/if}
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'broadcast issues'}
						onclick={() => {
							filter = 'broadcast issues';
						}}>Broacast Issues</button
					>
				</div>
				<div class="indicator">
					{#if not_broadcast.length > 0}<span
							class="text-xsm badge indicator-item badge-secondary badge-sm indicator-top"
							>{not_broadcast.length}</span
						>{/if}
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'not broadcast'}
						onclick={() => {
							filter = 'not broadcast';
						}}>Not Broadcast</button
					>
				</div>
			</div>
		</div>
	</Container>
	{#if outbox.length > 0}
		{#each filtered as o}
			<div
				class="group flex w-full items-center justify-between rounded hover:rounded-none hover:bg-base-200"
				class:bg-yellow-900={!o.broadly_sent && o.relay_logs.some((l) => l.success)}
				class:hover:bg-yellow-800={!o.broadly_sent && o.relay_logs.some((l) => l.success)}
				class:bg-red-900={!o.relay_logs.some((l) => l.success)}
				class:hover:bg-red-800={!o.relay_logs.some((l) => l.success)}
				class:bg-base-200={selected === o.id}
			>
				<button
					class="flex-grow cursor-pointer"
					onclick={() => {
						if (selected === o.id) selected = undefined;
						else selected = o.id;
					}}
				>
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between p-2">
							<div>
								<div class="badge">{kindtoTextLabel(o.event.kind)}</div>
								<span class="text-xs"><FromNow unix_seconds={o.event.created_at} /></span>
							</div>
							<div class="text-sm">
								sent to {o.relay_logs.filter((l) => l.success).length} / {o.relay_logs.length} relays
							</div>
						</div>
					</div>
				</button>
				<button
					class="btn btn-ghost btn-xs opacity-0 transition-opacity duration-300 group-hover:opacity-100"
					aria-label="dismiss"
					onclick={() => {
						db.outbox.delete(o.id);
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3 w-3"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>

			{#if selected === o.id}
				<div class="bg-base-300 px-4 py-2">
					{#each o.relay_logs.reduce((acc, log) => {
						log.groups.forEach((group) => acc.add(group));
						return acc;
					}, new Set<string>()) as group, i}
						<div class="collapse collapse-arrow my-2 bg-base-200">
							<input type="radio" name="my-accordion-2" />
							<div class="collapse-title text-sm">
								{#if group.length === 64}<UserHeader user={group} inline />'s {#if group === o.event.pubkey}outbox{:else}inbox{/if}
									relays
								{:else if group.length > 64 && group.startsWith(`${GitRepositoryAnnouncement}:`)}
									git repo: {group.split(':')[2]}'s relays
								{:else}{group}{/if} ({o.relay_logs.filter(
									(l) => l.groups.includes(group) && l.success
								).length} /
								{o.relay_logs.filter((l) => l.groups.includes(group)).length})
							</div>
							<div class="collapse-content">
								{#each o.relay_logs.filter((l) => l.groups.includes(group)) as log}
									<div class:text-success={log.success}>{log.url}</div>
									{#if !log.success}
										<div>
											attempts:
											<div>
												{#each log.attempts as attempt}
													<div class="text-xs">
														{attempt.success ? 'succeded' : 'failed'}
														<FromNow unix_seconds={attempt.timestamp} />
														{#if attempt.msg.length > 0}
															with "{attempt.msg}"
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/each}
	{/if}
</div>
