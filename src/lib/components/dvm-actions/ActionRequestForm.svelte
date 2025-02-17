<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import { inMemoryRelayEvent, RepoRouteStringCreator } from '$lib/helpers.svelte';
	import { ActionDvmKind, RepoStateKind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { type EventIdString, type RepoRef, type RepoRouteString } from '$lib/types';
	import { aRefToAddressPointer } from '$lib/utils';
	import { unixNow } from 'applesauce-core/helpers';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { onMount } from 'svelte';

	let { a_ref, onsubmitted }: { a_ref: RepoRef; onsubmitted: (id: EventIdString) => void } =
		$props();

	let link_creator = $derived(new RepoRouteStringCreator(a_ref));
	let repo_link: RepoRouteString = $derived(link_creator.s);

	let repo_state_pointer = $derived({
		...aRefToAddressPointer(a_ref),
		kind: RepoStateKind
	} as AddressPointer);
	let repo_state_query = $derived(
		inMemoryRelayEvent(repo_state_pointer, () => [repo_state_pointer])
	);
	let state_not_found = $state(false);
	onMount(() => {
		setTimeout(() => {
			if (!repo_state_query.event) {
				state_not_found = true;
				branch_or_tag = undefined;
			}
		}, 5000);
	});

	let refs = $derived(
		repo_state_query && repo_state_query.event
			? repo_state_query.event.tags
					.filter((t) => t[0] && t[0].startsWith('refs/') && t[0].indexOf('^{}') === -1)
					.sort((a, b) => a[0].localeCompare(b[0]))
			: []
	);

	let default_branch_or_tag = $derived.by(() => {
		if (repo_state_query && repo_state_query.event) {
			if (refs.map((t) => t[0]).includes('refs/heads/main')) return 'refs/heads/main';
			if (refs.map((t) => t[0]).includes('refs/heads/master')) return 'refs/heads/master';
		}
		return undefined;
	});

	let branch_or_tag = $state();
	let pipeline_filepath = $state('.github/workflows/ci.yaml');
	let runner_timeout = $state(20);

	let show_detailed = $state(false);
	let bid = $state(50);
	let min_vcpu = $state(1);
	let min_ram = $state(4000);
	let min_storage = $state(10000);

	let form_complete = $derived(!!branch_or_tag);
	let submitting = $state(false);
	let signed = $state(false);
	let rejected_by_signer = $state(false);
	let submitted = $state(false);

	const submit = async () => {
		submitting = true;

		const rejectedBySigner = () => {
			rejected_by_signer = true;
			setTimeout(() => {
				submitting = false;
				signed = false;
			}, 2000);
		};
		try {
			let request = await accounts_manager.getActive()?.signEvent({
				kind: ActionDvmKind,
				created_at: unixNow(),
				content: '',
				tags: [
					['a', $state.snapshot(a_ref)],
					['param', 'git_address', $state.snapshot(repo_link)],
					['param', 'git_ref', $state.snapshot(branch_or_tag)],
					['param', 'pipeline_filepath', $state.snapshot(pipeline_filepath)]
					// TODO: ['p', <dvm pubkey and publishEvent will send to 10002 inbox relays>]
				]
			});
			if (request) {
				signed = true;
				// this commit restricted the broadcast of ActionDvmKind to just the hardcoded relays
				// and not the inbox relays of the pubkeys tagged or the repo relays.
				// TODO: think about which relays should recieve this
				// TODO: do we really need to wait for the event to be broadly sent?
				//       we just need to be be received by one of the dvm relays before continuing
				await query_centre.publishEvent(request);
				submitted = true;
				onsubmitted(request.id);
			} else {
				rejectedBySigner();
			}
		} catch {
			rejectedBySigner();
		}
	};
</script>

<div class="max-w-xs space-y-2">
	<label class="form-control w-full max-w-xs">
		<div class="label">
			<span class="label-text">Branch / Tag <span class="required">*</span></span>
		</div>
		{#if state_not_found}
			<input
				disabled={submitting}
				type="text"
				placeholder="eg. refs/head/master"
				class="input input-sm input-bordered w-full max-w-xs"
				bind:value={branch_or_tag}
			/>
		{:else if !repo_state_query.event}
			<select class="select select-bordered select-sm">
				<option disabled selected>loading</option>
			</select>
		{:else}
			<select
				disabled={submitting}
				class="select select-bordered select-sm"
				bind:value={branch_or_tag}
			>
				<option disabled selected
					>{#if default_branch_or_tag}{default_branch_or_tag}{:else}choose branch or tag{/if}</option
				>
				{#each refs as tag}
					<option>{tag[0]}</option>
				{/each}
			</select>
		{/if}
	</label>
	<label class="form-control w-full max-w-xs">
		<div class="label">
			<span class="label-text">Yaml Path</span>
		</div>
		<input
			type="text"
			disabled={submitting}
			placeholder="eg .github/workflows/ci.yaml"
			class="input input-sm input-bordered w-full max-w-xs"
			bind:value={pipeline_filepath}
		/>
	</label>

	<label class="form-control w-full max-w-xs">
		<div class="label">
			<span class="label-text">Runner Timeout</span>
		</div>
		<label class="input input-sm input-bordered flex items-center gap-2">
			<input
				type="number"
				disabled={submitting}
				placeholder="Enter maximum sats"
				class="grow"
				bind:value={runner_timeout}
				min="1"
				max="120"
			/>
			<span class="text-sm">minutes</span>
		</label>
	</label>
	{#if show_detailed}
		<div class="max-w-xs">
			<label class="form-control w-full max-w-xs">
				<div class="label">
					<span class="label-text text-xs">Maximum Sats per Minute</span>
				</div>
				<input
					type="number"
					disabled={submitting}
					placeholder="Enter maximum sats"
					class="input input-xs input-bordered w-full max-w-xs"
					bind:value={bid}
					min="0"
					max="10000"
				/>
			</label>

			<label class="form-control w-full max-w-xs">
				<div class="label">
					<span class="label-text text-xs">Minimum vCPUs</span>
				</div>
				<input
					type="number"
					disabled={submitting}
					placeholder="Enter minimum vCPUs"
					class="input input-xs input-bordered w-full max-w-xs"
					bind:value={min_vcpu}
					min="1"
					max="64"
				/>
			</label>

			<label class="form-control w-full max-w-xs">
				<div class="label">
					<span class="label-text text-xs">Minimum RAM (MB)</span>
				</div>
				<input
					type="number"
					disabled={submitting}
					placeholder="Enter minimum RAM in MB"
					class="input input-xs input-bordered w-full max-w-xs"
					bind:value={min_ram}
					min="512"
					max="1024"
				/>
			</label>

			<label class="form-control w-full max-w-xs">
				<div class="label">
					<span class="label-text text-xs">Minimum Storage (GB)</span>
				</div>
				<input
					type="number"
					disabled={submitting}
					placeholder="Enter minimum storage in GB"
					class="input input-xs input-bordered w-full max-w-xs"
					bind:value={min_storage}
					min="1"
					max="2000"
				/>
			</label>
		</div>
	{/if}
	<div class="mt-4 flex items-center">
		<div class="-ml-2">
			<button
				type="button"
				class="btn btn-ghost btn-xs"
				onclick={() => (show_detailed = !show_detailed)}
			>
				{#if !show_detailed}
					More Options
				{:else}
					Less Options
				{/if}
			</button>
		</div>
		<div class="flex-grow"></div>
		<button
			type="button"
			class="btn btn-primary btn-sm"
			class:disabled:bg-success={submitted}
			class:disabled:text-success-content={submitted}
			class:disabled:bg-error={rejected_by_signer}
			class:disabled:text-error-content={rejected_by_signer}
			disabled={submitting || !form_complete || rejected_by_signer}
			onclick={() => {
				submit();
			}}
		>
			{#if submitting}
				{#if submitted}
					Request Sent
				{:else if signed}
					Submitting Request
				{:else}
					Signing Request
				{/if}
			{:else if rejected_by_signer}
				Rejected by Signer
			{:else}
				Request Runner
			{/if}
		</button>
	</div>
</div>
