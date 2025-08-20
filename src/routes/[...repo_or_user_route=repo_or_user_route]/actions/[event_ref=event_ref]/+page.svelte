<script lang="ts">
	import { neventOrNoteToHexId } from '$lib/utils';
	import { createActionsRequestFilter } from '$lib/relay/filters/actions';
	import { inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import Container from '$lib/components/Container.svelte';
	import FromNow from '$lib/components/FromNow.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import { eventsToDVMActionSummary } from '$lib/types/dvm';
	import { getTagValue } from 'applesauce-core/helpers';
	import { stringToDocTree } from '$lib/doc_tree';
	import ContentTree from '$lib/components/content-tree/ContentTree.svelte';
	import AlertError from '$lib/components/AlertError.svelte';
	import Duration from '$lib/components/Duration.svelte';
	import { routeToRepoRef, type PrOrIssueRouteData, type RepoRef } from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { event_ref } = data;

	let id = neventOrNoteToHexId(event_ref);

	let a_ref: RepoRef | undefined = $derived(store ? routeToRepoRef(store.route) : undefined);

	let request_query = $derived(
		!!id && !!a_ref ? query_centre.watchActionRequest(id, a_ref) : { event: undefined }
	);

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

	let patial_events = $derived(
		responses
			.filter((e) => getTagValue(e, 's') === 'partial')
			.sort((a, b) => a.created_at - b.created_at)
	);
	let log = $derived(patial_events.map((e) => e.content).join('\n'));

	// let success_event = $derived(responses.find((e) => getTagValue(e, 's') === 'success'));
	let job_last_response = $derived(
		responses.length > 0
			? responses.reduce((max, event) => {
					return event.created_at > max ? event.created_at : max;
				}, summary?.created_at ?? 0)
			: undefined
	);
</script>

{#if request_event}
	<div class="bg-base-200 py-3">
		<Container>
			<div class="flex flex-col flex-wrap md:flex-row md:space-x-16">
				{#if summary}
					{#if summary.branch}
						<div>
							<span class="text-sm text-gray-500">branch:</span>
							{summary.branch}
							{#if summary?.commit_id}({summary.commit_id.substring(0, 7)}){/if}
						</div>
					{:else if summary.tag}
						<div>
							<span class="text-sm text-gray-500">git ref:</span>
							{summary.tag}
							{#if summary?.commit_id}({summary.commit_id.substring(0, 7)}){/if}
						</div>
					{:else}
						<div><span class="text-sm text-gray-500">git ref:</span> {summary.git_ref}</div>
					{/if}
				{/if}
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
	{#if log.length > 0}
		<Container>
			{#if status === 'error'}
				<div class="mb-6">
					<AlertError>DVM error - {short_status_text}</AlertError>
				</div>
			{/if}
			<div
				class="h-[90vh] overflow-x-auto rounded-lg border bg-black p-4 shadow-lg"
				class:text-green-400={status_text === 'WorkflowSuccess'}
				class:border-green-600={status_text === 'WorkflowSuccess'}
				class:text-red-400={status_text === 'WorkflowError'}
				class:border-red-600={status_text === 'WorkflowError'}
			>
				<h2 class="mb-2 text-lg font-bold">Job Output</h2>
				<pre class="code">
					<ContentTree node={stringToDocTree(log, true)} />
				</pre>
			</div>
		</Container>
	{:else if status === 'processing'}
		<div class="flex items-center justify-center">
			<div class="mr-2">job accepted by DVM, awaiting logs...</div>
			<div class="loading loading-spinner loading-lg"></div>
		</div>
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
	<NotFound404Page repo_header_on_page msg="cannot find action request" />
{/if}
