import type { RepoRef } from './types';
import {
	type GitManagerEvent,
	type GitManagerLogEntry,
	type GitManagerLogEntryServer,
	type GitManagerRpcMethodNames,
	type GitManagerRpcMethodInfo,
	type GitManagerRpcMethodSigs,
	RPC_METHODS
} from './types/git-manager';
import store from './store.svelte';

type RpcMethods = GitManagerRpcMethodInfo;
type RpcNames = GitManagerRpcMethodNames;
type GitManager = GitManagerRpc & GitManagerRpcMethodSigs;

type Pending = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
};

export class GitManagerRpc extends EventTarget {
	private worker: Worker;
	private nextId = 1;
	private pending = new Map<number, Pending>();

	constructor() {
		super();
		this.worker = new Worker(new URL('./git-manager-worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker.onmessage = this.onMessage.bind(this);
		this.worker.onerror = (ev) => {
			const msg = ev?.message ?? 'worker-error';
			for (const [id, entry] of this.pending) {
				if (entry.timer) clearTimeout(entry.timer);
				entry.resolve(undefined); // TODO better error handling
				// entry.reject(new Error(String(msg)));
				console.log(new Error(String(msg)));
				this.pending.delete(id);
			}
		};

		// Attach RPC methods at runtime
		type MethodAssigner = <M extends RpcNames>(
			name: M
		) => (params: RpcMethods[M]['params']) => Promise<RpcMethods[M]['result']>;

		const assignMethod: MethodAssigner = (name) => (params) => this.callWorker(name, params);

		(RPC_METHODS as readonly RpcNames[]).forEach((name) => {
			(this as unknown as Record<string, unknown>)[name] = assignMethod(name);
		});
	}

	private settle(id: number, cb: (p: Pending) => void) {
		const p = this.pending.get(id);
		if (!p) return false;
		if (p.timer) clearTimeout(p.timer);
		this.pending.delete(id);
		cb(p);
		return true;
	}

	private onMessage(ev: MessageEvent) {
		const msg = ev.data;
		if (typeof msg !== 'object' || msg === null) return;

		// event: { kind: 'event', name: string, detail: unknown }
		const asRec = msg as Record<string, unknown>;
		if (asRec.kind === 'event' && typeof asRec.name === 'string') {
			const evt = msg as GitManagerEvent;
			if (evt.name === 'log') {
				const newEntry = evt.detail;

				// Don't push if entry is identical to the last entry
				if (!this.isIdenticalToLastEntry(newEntry)) {
					store.git_log.push(newEntry);

					// Remove duplicate phase entries, keeping only the latest
					if ('remote' in newEntry && newEntry.progress?.phase) {
						this.removeDuplicatePhaseEntries(newEntry);
					}
				}
			}
			this.dispatchEvent(new CustomEvent(evt.name, { detail: evt.detail }));
			return;
		}

		// response: { id: number, ok: boolean, result?: unknown, error?: string }
		const maybe = msg as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
		if (typeof maybe.id !== 'number') return;
		const id = maybe.id;
		if (maybe.ok === true) {
			this.settle(id, (p) => p.resolve(maybe.result));
		} else {
			const errMsg = typeof maybe.error === 'string' ? maybe.error : 'rpc-error';
			this.settle(id, (p) => p.reject(new Error(errMsg)));
		}
	}

	/**
	 * Check if the new entry is identical to the last entry for the same remote/sub combo.
	 * Searches backwards through the last 10 entries to find a matching remote/sub.
	 * Compares the content deeply, not just by reference.
	 */
	private isIdenticalToLastEntry(newEntry: GitManagerLogEntry): boolean {
		const log = store.git_log;
		if (log.length === 0) return false;

		// For server entries, find the last entry with the same remote/sub
		if ('remote' in newEntry) {
			const lastIndex = log.length - 1;
			const searchStart = Math.max(0, lastIndex - 9); // Last 10 entries

			// Search backwards for the last entry with same remote/sub
			for (let i = lastIndex; i >= searchStart; i--) {
				const entry = log[i];
				if ('remote' in entry && entry.remote === newEntry.remote) {
					const entrySub = entry.sub || '';
					const newSub = newEntry.sub || '';
					if (entrySub === newSub) {
						// Found matching remote/sub - compare content
						return JSON.stringify(entry) === JSON.stringify(newEntry);
					}
				}
			}
			// No matching remote/sub found in last 10 entries, not a duplicate
			return false;
		}

		// For global entries, just check the very last entry
		const lastEntry = log[log.length - 1];
		return JSON.stringify(lastEntry) === JSON.stringify(newEntry);
	}

	/**
	 * Remove duplicate phase entries from the last 10 log entries, keeping only the latest.
	 * This reduces noise by removing earlier progress updates for the same remote/sub/phase.
	 */
	private removeDuplicatePhaseEntries(newEntry: GitManagerLogEntryServer) {
		const log = store.git_log;
		const lastIndex = log.length - 1;
		const searchStart = Math.max(0, lastIndex - 10);

		// Build key for the new entry
		const newKey = `${newEntry.remote}|${newEntry.sub || ''}|${newEntry.progress?.phase}`;

		// Search backwards through last 10 entries (excluding the just-added entry)
		for (let i = lastIndex - 1; i >= searchStart; i--) {
			const entry = log[i];
			if ('remote' in entry && entry.progress?.phase) {
				const key = `${entry.remote}|${entry.sub || ''}|${entry.progress.phase}`;
				if (key === newKey) {
					// Found a duplicate - remove it (splice triggers reactivity)
					log.splice(i, 1);
					// Only remove the first duplicate found since entries come in fast
					break;
				}
			}
		}
	}

	private callWorker<M extends RpcNames>(
		method: M,
		params: RpcMethods[M]['params']
	): Promise<RpcMethods[M]['result']> {
		const id = this.nextId++;
		const payload = { id, action: 'call', params: { method: String(method), params } };
		this.worker.postMessage(payload);
		if (method === 'loadRepository') {
			if (this.a_ref !== (params as RpcMethods['loadRepository']['params']).a_ref)
				store.git_log = [];
			this.a_ref = (params as RpcMethods['loadRepository']['params']).a_ref;
			this.clone_urls = (params as RpcMethods['loadRepository']['params']).clone_urls;
		} else if (method === 'updateCloneUrls') {
			this.clone_urls = (params as RpcMethods['updateCloneUrls']['params']).clone_urls;
		}

		return new Promise<RpcMethods[M]['result']>((resolve, reject) => {
			const entry: Pending = {
				resolve: (v: unknown) => resolve(v as RpcMethods[M]['result']),
				reject
			};
			const t = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					resolve(undefined as unknown as RpcMethods[M]['result']); // prefered error handling
					// reject(new Error('timeout'));
				}
			}, 120_000);
			entry.timer = t;
			this.pending.set(id, entry);
		});
	}

	a_ref?: RepoRef;
	clone_urls?: string[];

	terminate() {
		try {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.terminate();
		} catch {
			// ignore
		}
		for (const [, entry] of this.pending) {
			if (entry.timer) clearTimeout(entry.timer);
			entry.resolve(undefined); // prefered error handling
			// entry.reject(new Error('terminated'));
		}
		this.pending.clear();
	}
}

// Export the singleton, cast to include the typed RPC client interface
export const git_manager = new GitManagerRpc() as GitManager;
export default git_manager;
