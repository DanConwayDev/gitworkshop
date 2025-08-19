import {
	isRelayCheck,
	isRepoRef,
	standardizeNip05,
	type EventIdString,
	type Nip05Address,
	type PubKeyString,
	type RepoRef,
	type WebSocketUrl
} from '$lib/types';
import { isEvent } from 'applesauce-core/helpers';
import memory_db from '$lib/dbs/InMemoryRelay';
import db from '$lib/dbs/LocalDb';
import {
	inMemoryRelayEvent,
	inMemoryRelayTimeline,
	inMemoryRelayTimelineRecursiveThread,
	liveQueryState
} from '$lib/helpers.svelte';
import type { NostrEvent } from 'nostr-tools';
import type { NAddrAttributes, NEventAttributes } from 'nostr-editor';
import store from '$lib/store.svelte';
import { RepoAnnKind } from '$lib/kinds';
import { liveQuery } from 'dexie';
import type { EventPointer } from 'nostr-tools/nip19';
import {
	createRecentActionsRequestFilter,
	createRecentActionsResultFilter
} from '$lib/relay/filters/actions';
import { createPubkeyNoficiationsFilters } from '$lib/relay/filters';

class QueryCentre {
	external_worker: Worker;

	constructor() {
		this.external_worker = new Worker(new URL('./QueryCentreExternal.ts', import.meta.url), {
			type: 'module'
		});
		this.external_worker.onmessage = (msg: MessageEvent<NostrEvent | unknown>) => {
			try {
				if (isEvent(msg?.data)) {
					memory_db.add(msg.data);
				}
			} catch {
				/* empty */
			}
		};
	}

	/**
	 * publish event to tagged npub's inbox relays and repo relays of tagged a_refs
	 * awaits the succesful broadcast to 'broadly sent'
	 *
	 */
	async publishEvent(event: NostrEvent) {
		const item = await db.outbox.get(event.id);
		if (!item) this.external_worker.postMessage({ method: 'publishEvent', args: [event] });
		await new Promise<void>((r) => {
			liveQuery(async () => {
				const item = await db.outbox.get(event.id);
				if (item?.broadly_sent) r();
			});
		});
	}

	fetchAllRepos(from_relays?: WebSocketUrl[]) {
		const current = $state({ loading: true });

		this.awaitExternalWorker({
			method: 'fetchAllRepos',
			args: from_relays ? [from_relays] : []
		}).then(() => {
			current.loading = false;
		});
		return current;
	}

	awaitExternalWorker<T>(call: { method: string; args: unknown[]; request_identifier?: string }) {
		const c = {
			...call,
			request_identifier: call.request_identifier || JSON.stringify(call)
		};
		return new Promise<T>((r) => {
			const handler = (msg: MessageEvent<{ request_identifier: string; result: T }>) => {
				try {
					if (msg.data.request_identifier === c.request_identifier) {
						this.external_worker.removeEventListener('message', handler);
						r(msg.data.result);
					}
				} catch {
					/* empty */
				}
			};
			this.external_worker.addEventListener('message', handler);
			this.external_worker.postMessage(c);
		});
	}

	fetchRepo(a_ref: RepoRef | string | undefined, hint_relays?: undefined | string[]) {
		const relays = $state.snapshot(hint_relays);
		let loading = $state(isRepoRef(a_ref));
		if (isRepoRef(a_ref)) {
			this.awaitExternalWorker<() => void>({ method: 'fetchRepo', args: [a_ref, relays] }).then(
				() => {
					loading = false;
				}
			);
		}
		// if a_ref its not RepoRef it we will just return the undefined
		return liveQueryState(
			async () => {
				if (isRepoRef(a_ref)) {
					const r = await db.repos.get(a_ref as RepoRef);
					if (r) return { ...r, loading };
					else return undefined;
				} else return undefined;
			},
			() => [loading],
			() => {
				if (isRepoRef(a_ref))
					this.external_worker.postMessage({ method: 'fetchRepoUnsubscribe', args: [a_ref] });
			}
		);
	}

	searchRepoAnns(query: string, from_relays?: WebSocketUrl[]) {
		return liveQueryState(async () => {
			const res = await db.repos
				.where('searchWords')
				.startsWithAnyOfIgnoreCase(query)
				.distinct()
				.filter((r) => !r.deleted)
				.toArray();
			if (from_relays)
				return res.filter((repo) =>
					from_relays.some((fr) =>
						repo.relays_info[fr]?.huristics.some((h) => isRelayCheck(h) && h.type == 'found')
					)
				);
			return res;
		});
	}

	fetchPubkeyRepos(pubkey: PubKeyString) {
		this.external_worker.postMessage({ method: 'fetchPubkeyRepos', args: [pubkey] });
		return liveQueryState(() =>
			db.repos
				.where('author')
				.equals(pubkey)
				.filter((r) => !r.deleted)
				.toArray()
		);
	}

	watchPubkeyNotifications(pubkey: PubKeyString, since?: number, internal_only = false) {
		if (!internal_only)
			this.external_worker.postMessage({
				method: 'watchPubkeyNotifications',
				args: [pubkey, since]
			});
		return inMemoryRelayTimeline(
			[...createPubkeyNoficiationsFilters(pubkey)],
			() => [pubkey],
			() => {
				if (!internal_only)
					this.external_worker.postMessage({
						method: 'watchPubkeyNotificationsUnsubscribe',
						args: [pubkey]
					});
			}
		);
	}

	fetchIssues(a_ref_or_issue_ids: RepoRef | EventIdString[]) {
		if (typeof a_ref_or_issue_ids === 'string')
			return liveQueryState(() =>
				db.issues.where('repos').equals(a_ref_or_issue_ids).reverse().sortBy('last_activity')
			);
		return liveQueryState(async () =>
			(await db.issues.bulkGet(a_ref_or_issue_ids)).filter((r) => !!r)
		);
	}

	fetchIssue(issue_id: EventIdString) {
		return liveQueryState(() => db.issues.get(issue_id));
	}

	watchIssueThread(a_ref: RepoRef, issue_id: EventIdString) {
		this.external_worker.postMessage({ method: 'watchIssueThread', args: [a_ref, issue_id] });
		// dynamically add in all the new replies and tagged events
		return inMemoryRelayTimelineRecursiveThread(
			issue_id,
			() => [],
			() => {
				if (isRepoRef(a_ref))
					this.external_worker.postMessage({
						method: 'watchIssueThreadUnsubscribe',
						args: [a_ref, issue_id]
					});
			}
		);
	}

	fetchPrs(a_refor_pr_ids: RepoRef | EventIdString[]) {
		if (typeof a_refor_pr_ids === 'string')
			return liveQueryState(() =>
				db.prs.where('repos').equals(a_refor_pr_ids).reverse().sortBy('last_activity')
			);
		return liveQueryState(async () => (await db.prs.bulkGet(a_refor_pr_ids)).filter((r) => !!r));
	}

	fetchPr(pr_id: EventIdString) {
		return liveQueryState(() => db.prs.get(pr_id));
	}

	watchPrThread(a_ref: RepoRef, pr_id: EventIdString) {
		this.external_worker.postMessage({ method: 'watchPrThread', args: [a_ref, pr_id] });
		// dynamically add in all the new replies and tagged events
		return inMemoryRelayTimelineRecursiveThread(
			pr_id,
			() => [],
			() => {
				if (isRepoRef(a_ref))
					this.external_worker.postMessage({
						method: 'watchPrThreadUnsubscribe',
						args: [a_ref, pr_id]
					});
			}
		);
	}

	fetchEvent(
		event_ref: NEventAttributes | EventPointer | NAddrAttributes,
		and_children: boolean = false
	) {
		// TODO add loading
		// TODO support for fetching naddr - right now they will display if in cache
		if (!('type' in event_ref) || event_ref.type !== 'naddr')
			this.external_worker.postMessage({ method: 'fetchEvent', args: [event_ref, and_children] });
		return inMemoryRelayEvent(event_ref);
	}

	fetchPubkeyName(pubkey: PubKeyString) {
		let loading = $state(true);
		this.awaitExternalWorker({ method: 'fetchPubkeyName', args: [pubkey] }).then(() => {
			loading = false;
		});
		// if a_ref its not RepoRef it we will just return the undefined
		return liveQueryState(
			async () => {
				const r = await db.pubkeys.get(pubkey);
				if (r) return { ...r, loading };
				else return undefined;
			},
			() => [loading]
		);
	}

	fetchNip05(nip05: Nip05Address) {
		let loading = $state(true);
		const standardized_nip05 = standardizeNip05(nip05);
		if (store.route?.type === 'nip05' && store.route?.nip05 === nip05) {
			store.route.loading = true;
		}
		const processResult = (pubkey: PubKeyString | undefined) => {
			if (store.route?.type === 'nip05' && store.route?.nip05 === nip05) {
				store.route = {
					...store.route,
					pubkey,
					loading: false,
					a_ref:
						'identifier' in store.route && pubkey
							? `${RepoAnnKind}:${pubkey}:${store.route.identifier}`
							: undefined
				};
			}
			loading = false;
		};
		db.pubkeys
			.where('verified_nip05')
			.equals(standardized_nip05)
			.first()
			.then((table_item) => {
				if (table_item) processResult(table_item.pubkey);
				else {
					this.awaitExternalWorker({ method: 'fetchNip05', args: [standardized_nip05] }).then((p) =>
						processResult(p as PubKeyString | undefined)
					);
				}
			});
		return liveQueryState(
			async () => {
				const r = await db.pubkeys.where('verified_nip05').equals(standardized_nip05).first();
				if (r) return { user: r, loading };
				else return { user: undefined, loading };
			},
			() => [loading]
		);
	}

	watchActionRequest(request_id: EventIdString, repo_ref: RepoRef) {
		this.external_worker.postMessage({ method: 'fetchRecentActions', args: [repo_ref] });
		this.external_worker.postMessage({ method: 'watchActions', args: [repo_ref] });
		return inMemoryRelayEvent(
			request_id,
			() => [request_id],
			() => {
				this.external_worker.postMessage({ method: 'watchActionsUnsubscribe', args: [repo_ref] });
			}
		);
	}

	watchRecentActions(a_ref: RepoRef) {
		this.external_worker.postMessage({ method: 'fetchRecentActions', args: [a_ref] });
		this.external_worker.postMessage({ method: 'watchActions', args: [a_ref] });
		return inMemoryRelayTimeline(
			[...createRecentActionsRequestFilter(a_ref), ...createRecentActionsResultFilter(a_ref)],
			() => [a_ref],
			() => {
				this.external_worker.postMessage({ method: 'watchActionsUnsubscribe', args: [a_ref] });
			}
		);
	}

	watchRecentActionRequests(a_ref: RepoRef) {
		this.external_worker.postMessage({ method: 'fetchRecentActions', args: [a_ref] });
		this.external_worker.postMessage({ method: 'watchActions', args: [a_ref] });
		return inMemoryRelayTimeline(
			createRecentActionsRequestFilter(a_ref),
			() => [a_ref],
			() => {
				this.external_worker.postMessage({ method: 'watchActionsUnsubscribe', args: [a_ref] });
			}
		);
	}

	watchWallet(pubkey: PubKeyString) {
		this.external_worker.postMessage({ method: 'watchWallet', args: [pubkey] });
		return () => {
			this.external_worker.postMessage({ method: 'watchWalletUnsubscribe', args: [pubkey] });
		};
	}
}

const query_centre = new QueryCentre();
export default query_centre;
