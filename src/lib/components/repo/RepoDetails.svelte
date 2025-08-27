<script lang="ts">
	import { icons_misc } from '$lib/icons';
	import {
		repoTableItemDefaults,
		type PubKeyString,
		type RepoRef,
		type RepoRoute,
		type RepoTableItem,
		type WebSocketUrl
	} from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { WithLoading } from '$lib/types/ui';
	import { repoRouteToNostrUrl } from '$lib/git-utils';
	import UserHeader from '$lib/components/user/UserHeader.svelte';
	import AlertWarning from '$lib/components/AlertWarning.svelte';
	import { DeletionKind, kindtoTextLabel } from '$lib/kinds';
	import { GitRepositoryAnnouncement } from '$lib/kind_labels';
	import { unixNow } from 'applesauce-core/helpers';
	import accounts_manager from '$lib/accounts';
	import AlertError from '../AlertError.svelte';
	import store from '$lib/store.svelte';
	import { nip19 } from 'nostr-tools';

	let {
		repo,
		repo_route,
		a_ref
	}: {
		repo?: RepoTableItem & Partial<WithLoading>;
		a_ref?: RepoRef;
		repo_route: RepoRoute;
	} = $props();

	let record_query = $derived(a_ref ? query_centre.fetchRepo(a_ref, repo_route.relays) : undefined);
	let item = $derived(
		repo ?? record_query?.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined)
	);

	let nostr_url = $derived(repoRouteToNostrUrl(repo_route));
	let nostr_url_copied = $state(false);
	let git_url_copied: string | false = $state(false);
	let maintainer_copied = $state(false);
	let short_descrption = $derived.by(() => {
		const n = item?.description ?? '';
		return n.length > 500 ? `${n.slice(0, 450)}...` : n;
	});

	let loading = $derived(!item || (!item.created_at && item?.loading));
	let repo_not_found = $derived(!loading && item && !item.created_at);

	const cloneUrlToGrasp = (
		clone_url: string,
		relay_urls: string[]
	): { shorthand: string; clone: string; wss: WebSocketUrl; pubkey: PubKeyString } | undefined => {
		if (!(clone_url.startsWith('http://') || clone_url.startsWith('https://'))) return undefined;
		if (!(clone_url.endsWith('.git/') || clone_url.endsWith('.git'))) return undefined;
		if (!clone_url.includes('/npub1')) return undefined;
		try {
			let res = nip19.decode(`npub1${clone_url.split('npub1')[1].split('/')[0]}`);
			if (res.type !== 'npub') return undefined;
			let pubkey: PubKeyString = res.data;
			let wss = clone_url.split('/npub1')[0].replace('http', 'ws') as WebSocketUrl;
			if (!relay_urls.some((u) => u.startsWith(wss))) return undefined;
			return {
				clone: clone_url,
				wss,
				shorthand: wss.replace('wss://', ''),
				pubkey
			};
		} catch {
			return undefined;
		}
	};

	let grasp_servers = $derived(
		item?.clone
			?.map((url) => cloneUrlToGrasp(url, item?.relays ?? []))
			.filter((v) => v !== undefined) ?? []
	);
	// let other_clone_urls = $derived(
	// 	item?.clone?.filter((url) => !grasp_servers.some((o) => o?.clone == url)) ?? []
	// );
	// let other_relays = $derived(
	// 	item?.relays?.filter((url) => !grasp_servers.some((o) => url == o.wss || url == `${o.wss}/`)) ??
	// 		[]
	// );

	// deletion
	let allow_delete = $derived.by(() => {
		// logged in user must be repo author
		if (!store.logged_in_account || store.logged_in_account.pubkey !== item?.author) return false;
		// cant already be deleted
		if (item && item.deleted) return false;
		// maximum number of issues and PRs
		let num_issues = Object.values(item?.issues ?? {}).reduce(
			(sum, issueArray) => sum + (issueArray?.length || 0),
			0
		);
		let num_PRs = Object.values(item?.PRs ?? {}).reduce(
			(sum, PRArray) => sum + (PRArray?.length || 0),
			0
		);
		return num_PRs + num_issues < 5;
	});
	let show_delete_sure_modal = $state(false);
	let sending_deletion = $state(false);
	let rejected_deletion = $state(false);
	let deletion_rationale = $state('');
	const sendDeletion = async () => {
		let signer = accounts_manager.getActive();
		if (sending_deletion || !signer) return;
		sending_deletion = true;
		let tags: string[][] = [
			['a', item?.uuid ?? a_ref ?? ''],
			['k', GitRepositoryAnnouncement.toString()]
		];
		// Add e tag with the event ID to be deleted for relays that don't support a-tag deletion
		if (item?.event_id) {
			tags.push(['e', item.event_id]);
		}
		([] as string[][]).forEach((t) => {
			if (t.length > 1 && !tags.some((e) => e[0] === t[0] && e[1] === t[1])) tags.push(t);
		});
		try {
			console.log('get signer');
			let d_event = await signer.signEvent({
				kind: DeletionKind,
				created_at: unixNow(),
				tags,
				content: $state.snapshot(deletion_rationale)
			});
			if (d_event) {
				query_centre.publishEvent(d_event);
			}
		} catch {
			rejected_deletion = true;
			sending_deletion = false;
		}
		setTimeout(
			() => {
				if (!rejected_deletion) {
					show_delete_sure_modal = false;
					deletion_rationale = '';
				}
				rejected_deletion = false;
				sending_deletion = false;
			},
			rejected_deletion ? 1500 : 500
		);
	};
	const closeModals = () => {
		show_delete_sure_modal = false;
	};
</script>

<div class="prose w-full max-w-md">
	{#if item && item.deleted}
		<div class="mb-3">
			<AlertError mt={0}
				>Repository deleted by <UserHeader user={item.author} inline={true} /></AlertError
			>
		</div>
	{/if}
	{#if !item || loading || repo_not_found}
		<h4 class="mt-0 pt-1 text-xs opacity-50">identifier</h4>
		<p class="my-2 text-sm break-words">{repo_route.identifier}</p>
	{:else if item.name == item.identifier}
		<h4 class="mt-0 pt-1 text-xs opacity-50">name / identifier</h4>
		<p class="my-2 text-sm break-words">{item.name}</p>
	{:else}
		<h4 class="text-xs opacity-50">name</h4>
		{#if !item.name || item.name.length == 0}
			<div>none</div>
		{:else}
			<p class="my-2 text-sm break-words">{item.name}</p>
		{/if}
		<h4 class="text-xs opacity-50">identifier</h4>
		{#if !item.identifier || item.identifier.length == 0}
			<div>none</div>
		{:else}
			<p class="my-2 text-sm break-words">{item.identifier}</p>
		{/if}
	{/if}

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
		{:else}
			<h4 class="text-xs opacity-50">
				nostr clone url {#if nostr_url_copied}<span class="text-success text-sm opacity-50">
						(copied to clipboard)</span
					>{/if}
			</h4>
			<!-- eslint-disable-next-line svelte/valid-compile -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				onclick={async () => {
					try {
						await navigator.clipboard.writeText(nostr_url);
						nostr_url_copied = true;
						setTimeout(() => {
							nostr_url_copied = false;
						}, 2000);
					} catch {
						/* empty */
					}
				}}
				class="group my-2 mt-3 cursor-pointer text-sm break-words"
				class:text-success={nostr_url_copied}
				class:opacity-50={nostr_url_copied}
			>
				{nostr_url}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="fill-base-content ml-1 inline h-4 w-4 flex-none opacity-50"
					class:group-hover:opacity-100={!nostr_url_copied}
					class:fill-base-content={!nostr_url_copied}
					class:fill-success={nostr_url_copied}
					class:opacity-100={nostr_url_copied}
				>
					{#each icons_misc.copy as d (d)}
						<path {d} />
					{/each}
				</svg>
			</div>

			<div class="bg-base-300 inline-block p-2">
				<span class="opacity-60">
					just <a href="/ngit" class="link-primary">install ngit</a> and run</span
				>
				<div class="bg-base-400 inline-block rounded-md p-2 font-mono text-sm">
					git clone nostr://...
				</div>
			</div>
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else if !short_descrption || short_descrption.length == 0}
			<h6>description</h6>
			<div>none</div>
		{:else}
			<h4 class="text-xs opacity-50">description</h4>
			<p class="my-2 text-sm break-words">{short_descrption}</p>
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="badge skeleton w-20"></div>
			<div class="badge skeleton w-20"></div>
		{:else if item.tags}
			{#each item.tags as tag (tag)}
				<div class="badge badge-secondary mr-2">{tag}</div>
			{/each}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
		{:else}
			<h4 class="text-xs opacity-50">grasp servers</h4>
			{#if !item.clone || grasp_servers.length == 0}
				<div>none</div>
			{:else}
				{#each grasp_servers as { shorthand, clone } (clone)}
					<div class="my-1">
						<a href="/relay/{shorthand}" class="btn btn-secondary btn-xs">{shorthand}</a>
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
		{:else}
			<h4 class="text-xs opacity-50">
				git servers {#if git_url_copied}<span class="text-success text-sm opacity-50">
						(copied to clipboard)</span
					>{/if}
			</h4>
			{#if !item.clone || item.clone.length == 0}
				<div>none</div>
			{:else}
				{#each item.clone as git_url (git_url)}
					<!-- eslint-disable-next-line svelte/valid-compile -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						onclick={async () => {
							try {
								await navigator.clipboard.writeText(git_url);
								git_url_copied = git_url;
								setTimeout(() => {
									git_url_copied = false;
								}, 2000);
							} catch {
								/* empty */
							}
						}}
						class="group my-2 mt-3 cursor-pointer text-xs break-words"
						class:text-success={git_url_copied === git_url}
						class:opacity-50={git_url_copied === git_url}
					>
						{git_url}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="fill-base-content ml-1 inline h-4 w-4 flex-none opacity-50"
							class:group-hover:opacity-100={git_url_copied !== git_url}
							class:fill-base-content={git_url_copied !== git_url}
							class:fill-success={git_url_copied === git_url}
							class:opacity-100={git_url_copied === git_url}
						>
							{#each icons_misc.copy as d (d)}
								<path {d} />
							{/each}
						</svg>
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else if !item.web || item.web.length == 0}
			<h4 class="text-xs opacity-50">websites</h4>
			<div>none</div>
		{:else}
			<h4 class="text-xs opacity-50">websites</h4>
			{#each item.web as site (site)}
				<a href={site} target="_blank" class="link link-primary my-2 text-sm break-words">
					{site}
				</a>
			{/each}
		{/if}
	</div>

	<div>
		{#if !item || loading || !item.author}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else}
			<h4 class="text-xs opacity-50">
				{#if repo_not_found}author{:else}maintainers{/if}
				{#if maintainer_copied}<span class="text-success text-sm opacity-50">
						(copied to clipboard)</span
					>{/if}
			</h4>
			{#if !item.maintainers || item.maintainers.length == 0}
				<div class="my-2 mt-3 text-xs break-words">
					<UserHeader user={item.author} />
				</div>
			{:else}
				{#each item.maintainers as maintainer (maintainer)}
					<div class="my-2 mt-3 text-xs break-words">
						<UserHeader user={maintainer} />
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else if !item.relays || item.relays.length == 0}
			<h4 class="text-xs opacity-50">relays</h4>
			<div>none</div>
		{:else}
			<h4 class="text-xs opacity-50">relays</h4>
			{#each item.relays as relay (relay)}
				<div class="badge badge-secondary badge-sm my-2 block">{relay}</div>
			{/each}
		{/if}
	</div>

	<div>
		{#if repo_not_found}<div></div>
		{:else if !item || loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else if !item.unique_commit || item.unique_commit.length == 0}
			<h4 class="text-xs opacity-50">earliest unique commit</h4>
			<p class="my-2 text-xs break-words">not specified</p>
		{:else}
			<h4 class="text-xs opacity-50">earliest unique commit</h4>
			<p class="my-2 text-xs break-words">{item.unique_commit}</p>
		{/if}
	</div>
	{#if allow_delete}
		<div class="align-right mt-5">
			<div class="tooltip align-middle" data-tip="Delete Repo Announcement">
				<button
					onclick={() => {
						show_delete_sure_modal = true;
					}}
					class="btn btn-xs text-neutral-content hover:bg-error"
					aria-label="delete"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
						><path
							fill="currentColor"
							d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3zm0 5h2v9H9zm4 0h2v9h-2z"
						/></svg
					>
					Delete Repo Announcement
				</button>
			</div>
		</div>
	{/if}
	{#if repo_not_found}
		<div class="text-xs">
			<AlertWarning>
				<div class="pb-1 font-semibold">missing repository details</div>
				<div>cannot find referenced repository event</div>
			</AlertWarning>
		</div>
	{/if}
</div>

{#if show_delete_sure_modal}
	<dialog class="modal" class:modal-open={show_delete_sure_modal}>
		<div class="modal-box relative max-w-lg p-6 text-wrap">
			<div class="modal-body mb-5 text-center">
				<h3 class="text-md mb-3 font-bold">
					Send <span class="badge badge-secondary badge-lg"
						>{kindtoTextLabel(GitRepositoryAnnouncement)}</span
					> Deletion Request?
				</h3>
				<p class="text-warning mt-6 text-sm">
					warning: not all nostr relays / clients honour deletion requests
				</p>
				<input
					type="text"
					disabled={sending_deletion}
					bind:value={deletion_rationale}
					class="input-neutral input input-sm mt-6 w-full"
					placeholder="optional deletion rationale"
				/>
			</div>
			<div class="modal-footer flex justify-between gap-4">
				<button
					class="btn btn-error flex-1"
					onclick={() => sendDeletion()}
					disabled={sending_deletion}
				>
					{#if rejected_deletion}
						Rejected by Signer
					{:else if sending_deletion}
						Signing
					{:else}
						Send Deletion Request
					{/if}
				</button>
				<button class="btn flex-1" onclick={closeModals}> Cancel </button>
			</div>
		</div>
	</dialog>
{/if}
