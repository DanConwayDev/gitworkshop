<script lang="ts">
	import { extractIssueTitle, extractRepoRefsFromPrOrIssue } from '$lib/git-utils';
	import { selected_a_ref } from '$lib/store.svelte';
	import { nip19, type NostrEvent } from 'nostr-tools';

	let { event }: { event: NostrEvent & { kind: 1621 } } = $props();
	let a_ref = $derived.by(() => {
		let refs = extractRepoRefsFromPrOrIssue(event);

		if (selected_a_ref && refs.some((r) => r.a_ref === selected_a_ref)) {
			return selected_a_ref;
		} else {
			return refs[0].a_ref;
		}
	});
</script>

<div>
	Git Issue for <a class="opacity-50" href={`/${a_ref}`}>{a_ref.split(':')[2]}</a>:
	<a href={`/${a_ref}/issues//${nip19.noteEncode(event.id)}`}>{extractIssueTitle(event)}</a> by
</div>
