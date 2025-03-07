<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import { type PrOrIssueRouteData } from '$lib/types';
	import { neventOrNoteToHexId } from '$lib/utils';
	import { createActionsRequestFilter } from '$lib/relay/filters/actions';
	import { inMemoryRelayEvent, inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import Container from '$lib/components/Container.svelte';
	import FromNow from '$lib/components/FromNow.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import { eventsToDVMActionSummary } from '$lib/types/dvm';
	import { getTagValue } from 'applesauce-core/helpers';
	import { stringToDocTree } from '$lib/doc_tree';
	import ContentTree from '$lib/components/content-tree/ContentTree.svelte';
	import AlertError from '$lib/components/AlertError.svelte';
	import Duration from '$lib/components/Duration.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { event_ref } = data;

	let id = neventOrNoteToHexId(event_ref);

	let request_query = $derived.by(() => {
		try {
			const d = nip19.decode(event_ref);
			if (d.type === 'nevent') return inMemoryRelayEvent(d.data);
		} catch {
			return undefined;
		}
	});
	let request_event = $derived(request_query?.event);

	let responses_query = $derived(
		id ? inMemoryRelayTimeline(createActionsRequestFilter(id), () => [id]) : { timeline: [] }
	);
	let responses = $derived(responses_query.timeline);

	let summary = $derived(
		request_event ? eventsToDVMActionSummary(request_event, responses) : undefined
	);
	let status = $derived(summary ? summary.status : 'no_response');
	let status_text = $derived(summary ? summary.status_commentary : '');

	let short_status_text = $derived(
		status_text.length > 70 ? `${status_text.slice(0, 65)}...` : status_text
	);

	let success_event = $derived(responses.find((e) => getTagValue(e, 's') === 'success'));
	let job_last_response = $derived(
		responses.reduce((max, event) => {
			return event.created_at > max ? event.created_at : max;
		}, summary?.created_at ?? 0)
	);
</script>

{#if request_event}
	<div class="bg-base-200 py-3">
		<Container>
			<div class="flex flex-col space-x-16 md:flex-row">
				<div><span class="text-sm text-gray-500">branch:</span> {summary?.git_ref}</div>
				<div><span class="text-sm text-gray-500">action:</span> {summary?.workflow_filepath}</div>
				<div>
					<span class="text-sm text-gray-500">duration:</span>
					<Duration to_s={job_last_response} from_s={summary?.created_at ?? 0} />
				</div>
				<div><span class="text-sm text-gray-500">status:</span> {status} ({short_status_text})</div>
				<div>
					<span class="text-sm text-gray-500">requested:</span>
					<FromNow unix_seconds={request_event.created_at} />
				</div>
			</div>
		</Container>
	</div>
	{#if success_event}
		<Container>
			<div
				class="h-[90vh] overflow-x-auto rounded-lg border bg-black p-4 shadow-lg"
				class:text-green-400={status_text === 'PipelineSuccess'}
				class:border-green-600={status_text === 'PipelineSuccess'}
				class:text-red-400={status_text === 'PipelineError'}
				class:border-red-600={status_text === 'PipelineError'}
			>
				<h2 class="mb-2 text-lg font-bold">Job Output</h2>
				<pre class="code">
					<ContentTree node={stringToDocTree(success_event.content)} />
				</pre>
			</div>
		</Container>
	{:else if status === 'pending_response'}
		<div class="flex items-center justify-center">
			<div class="mr-2">waiting for DVM</div>
			<div class="loading loading-spinner loading-lg"></div>
		</div>
	{:else if status === 'payment_issue'}
		<AlertError>Payment Issue: {short_status_text}</AlertError>
	{:else if status === 'no_response'}
		<AlertError>DVM never responsed</AlertError>
	{:else if status === 'error'}
		<AlertError>{short_status_text}</AlertError>
	{/if}
{:else}
	<NotFound404Page repo_header_on_page msg={`cannot find action request`} />
{/if}
