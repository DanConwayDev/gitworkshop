import type { RepoRef } from './types';
import {
	type GitManagerEvent,
	type GitManagerRpcMethodNames,
	type GitManagerRpcMethodInfo,
	type GitManagerRpcMethodSigs,
	type GitManagerLogEntry,
	RPC_METHODS
} from './types/git-manager';

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

	constructor(workerUrl = new URL('./git-manager-worker.ts', import.meta.url)) {
		super();
		this.worker = new Worker(workerUrl, { type: 'module' });
		this.worker.onmessage = this.onMessage.bind(this);
		this.worker.onerror = (ev) => {
			const msg = ev?.message ?? 'worker-error';
			for (const [id, entry] of this.pending) {
				if (entry.timer) clearTimeout(entry.timer);
				entry.reject(new Error(String(msg)));
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

	logs: GitManagerLogEntry[] = [];
	private onMessage(ev: MessageEvent) {
		const msg = ev.data;
		if (typeof msg !== 'object' || msg === null) return;

		// event: { kind: 'event', name: string, detail: unknown }
		const asRec = msg as Record<string, unknown>;
		if (asRec.kind === 'event' && typeof asRec.name === 'string') {
			const evt = msg as GitManagerEvent;
			if (evt.name === 'log') {
				this.logs.push(evt.detail);
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

	private callWorker<M extends RpcNames>(
		method: M,
		params: RpcMethods[M]['params']
	): Promise<RpcMethods[M]['result']> {
		const id = this.nextId++;
		const payload = { id, action: 'call', params: { method: String(method), params } };
		this.worker.postMessage(payload);
		if (method === 'loadRepository') {
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
