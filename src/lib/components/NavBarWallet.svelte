<script lang="ts">
	import db from '$lib/dbs/LocalDb';
	import { liveQueryState } from '$lib/helpers.svelte';
	import { kindtoTextLabel } from '$lib/kinds';
	import type { EventIdString } from '$lib/types';
	import FromNow from './FromNow.svelte';
	import UserHeader from './user/UserHeader.svelte';

	let outbox_query = liveQueryState(() => {
		return db.outbox.toArray();
	});
	let outbox = $derived(
		[...(outbox_query.current ?? [])].sort((a, b) => b.event.created_at - a.event.created_at) ?? []
	);
	let not_broadly_sent = $derived(outbox.filter((o) => !o.broadly_sent));

	let filter: 'all' | 'broadcast issues' | 'not broadcast' = $state('not broadcast');
	let filtered = $derived(
		outbox.filter((o) => {
			if (filter === 'all') return true;
			if (filter === 'broadcast issues') return !o.broadly_sent;
			return o.relay_logs.every((l) => !l.success);
		})
	);

	let is_open = $state(false);
	let selected: EventIdString | undefined = $state(undefined);
</script>

{#if outbox.length > 0}
	<div class="relative">
		<button
			class="btn btn-ghost btn-sm"
			onclick={() => {
				is_open = !is_open;
			}}
		>
			<div class="indicator">
				{#if not_broadly_sent.length > 0}
					<span class="text-xsm badge indicator-item badge-secondary badge-sm indicator-bottom"
						>{not_broadly_sent.length}</span
					>
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48"
					><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"
						><path stroke-linecap="round" d="M4 30L9 6h30l5 24" /><path
							fill="currentColor"
							d="M4 30h10.91l1.817 6h14.546l1.818-6H44v13H4z"
						/><path stroke-linecap="round" d="m18 20l6-6l6 6m-6 6V14" /></g
					></svg
				>
			</div>
		</button>
		{#if is_open}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-10"
				onclick={() => {
					is_open = !is_open;
				}}
			></div>

			<div
				class="absolute right-0 top-full z-20 mt-2 h-80 w-96 overflow-y-auto rounded-lg bg-base-400 p-4 shadow-lg"
			>
				<div class="flex space-x-2">
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'all'}
						onclick={() => {
							filter = 'all';
						}}>All</button
					>
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'broadcast issues'}
						onclick={() => {
							filter = 'broadcast issues';
						}}>Broacast Issues</button
					>
					<button
						class="btn btn-xs"
						class:btn-primary={filter === 'not broadcast'}
						onclick={() => {
							filter = 'not broadcast';
						}}>Not Broadcast</button
					>
				</div>

				{#each filtered as o}
					<div class="group flex w-full items-center justify-between p-2 hover:bg-base-200">
						<button
							class="grow cursor-pointer"
							class:bg-base-300={selected === o.id}
							onclick={() => {
								if (selected === o.id) selected = undefined;
								else selected = o.id;
							}}
						>
							<div class="badge">{kindtoTextLabel(o.event.kind)}</div>
							<span class="text-xs"><FromNow unix_seconds={o.event.created_at} /></span>
							sent to {o.relay_logs.filter((l) => l.success).length} / {o.relay_logs.length} relays
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
						<div>
							{#each o.relay_logs.reduce((acc, log) => {
								log.groups.forEach((group) => acc.add(group));
								return acc;
							}, new Set<string>()) as group, i}
								<div class="collapse collapse-arrow bg-base-300">
									<input type="radio" name="my-accordion-2" checked={i ? true : undefined} />
									<div class="collapse-title">
										{#if group.length === 64}<UserHeader user={group} inline />'s inbox relays
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
			</div>
		{/if}
	</div>
{/if}
