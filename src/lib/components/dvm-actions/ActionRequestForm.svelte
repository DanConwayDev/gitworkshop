<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import { inMemoryRelayEvent, inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import { ActionDvmRequestKind, RepoStateKind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { createActionDVMProvidersFilter } from '$lib/relay/filters/actions';
	import { type EventIdString, type RepoRef } from '$lib/types';
	import { eventToActionsDVMProvider } from '$lib/types/dvm';
	import { aRefToAddressPointer } from '$lib/utils';
	import { unixNow } from 'applesauce-core/helpers';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { onMount } from 'svelte';
	import FromNow from '../FromNow.svelte';
	import { nip19 } from 'nostr-tools';

	let { a_ref, onsubmitted }: { a_ref: RepoRef; onsubmitted: (id: EventIdString) => void } =
		$props();

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

	let branch_or_tag = $state(undefined);
	let selected_commit = $derived(
		refs.find((r) => r.length > 1 && branch_or_tag && r[0] === branch_or_tag)?.[1]
	);
	let workflow_filepath = $state('.github/workflows/ci.yaml');
	let runner_timeout_mins = $state(20);

	let git_ref = $derived((branch_or_tag ?? '').replace('refs/heads/', ''));

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
				kind: ActionDvmRequestKind,
				created_at: unixNow(),
				content: '',
				tags: [
					['a', $state.snapshot(a_ref)],
					[
						'param',
						'git_address',
						$state.snapshot(nip19.naddrEncode(aRefToAddressPointer(a_ref) as AddressPointer))
					],
					// ['param', 'git_address', $state.snapshot(repo_link)],

					['param', 'git_ref', $state.snapshot(git_ref)],
					['param', 'workflow_filepath', $state.snapshot(workflow_filepath)],
					['param', 'workflow_timeout', $state.snapshot(runner_timeout_mins * 60).toString()],
					...(selected_commit ? [['commit', $state.snapshot(selected_commit)]] : []),
					['payment', 'TODO']
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
				query_centre.publishEvent(request);
				submitted = true;
				onsubmitted(request.id);
			} else {
				rejectedBySigner();
			}
		} catch {
			rejectedBySigner();
		}
	};

	let dvm_providers_query = $derived(inMemoryRelayTimeline(createActionDVMProvidersFilter()));
	let dvm_providers_anns = $derived(dvm_providers_query.timeline);
</script>

<div class="grid grid-cols-4">
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
				bind:value={workflow_filepath}
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
					bind:value={runner_timeout_mins}
					min="1"
					max="120"
				/>
				<span class="text-sm">minutes</span>
			</label>
		</label>
	</div>

	<div>
		{#each dvm_providers_anns.map(eventToActionsDVMProvider).filter((p) => !!p) as provider_ann}
			<div class="m-2 mt-4 rounded-lg bg-base-300 p-4">
				<!-- {getTagValue()} -->
				<div class="flex items-center">
					<div class="flex">
						<div class="prose flex-grow">
							<h3 class="">
								{provider_ann.name}
							</h3>
						</div>
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
								Start for {Number(provider_ann.price_per_second) * 60 * runner_timeout_mins}
								{provider_ann.unit}
							{/if}
						</button>
					</div>
				</div>
				<div class="">{provider_ann.about}</div>
				<div class="">{provider_ann.mints.join(', ')}</div>
				<div class="">last active <FromNow unix_seconds={provider_ann.last_pong} /></div>
			</div>
		{/each}
	</div>
</div>
