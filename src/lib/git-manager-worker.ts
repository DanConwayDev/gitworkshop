import git, {
	type FetchResult,
	type GitHttpRequest,
	type GitHttpResponse,
	type HttpClient,
	type ReadCommitResult
} from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import {
	isGitManagerLogEntryServer,
	isGitManagerMethod,
	type CommitInfo,
	type FileEntry,
	type GitManagerEvent,
	type GitManagerLogEntry,
	type GitManagerRpcMethodSigs,
	type SelectedPathInfo
} from '$lib/types/git-manager';
import { Buffer as BufferPolyfill } from 'buffer';
import { createPatch } from 'diff';
import { cloneUrlToRemoteName } from './git-utils';
import type { RepoRef } from './types';
// required for isomorphic-git with vite
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare let Buffer: typeof BufferPolyfill;
globalThis.Buffer = BufferPolyfill;

const cors_proxy_base_url = 'https://cors.isomorphic-git.org';

type ConnectionErrors = 'cors' | '404' | 'timeout' | 'unknown';

type ConnectionOk = { status: 'ok' };
type ConnectionFail = {
	status: 'fail';
	kind: ConnectionErrors;
	message?: string;
	tried: string; // single URL attempted
	httpStatus?: number;
};
type ConnectionResult = ConnectionOk | ConnectionFail;

function isAbortError(err: unknown): err is { name?: string } {
	return (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string | undefined }).name === 'AbortError'
	);
}

async function httpGitServerConnectionTest(
	url: string,
	use_proxy: boolean = false,
	timeoutMs: number = 8000
): Promise<ConnectionResult> {
	const tryOnce = async (): Promise<ConnectionResult> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		const base = (
			use_proxy ? `${cors_proxy_base_url}/${url.replace(/^https?:\/\//, '')}` : url
		).replace(/\/+$/, '');
		const candidate = `${base}/info/refs?service=git-upload-pack`;

		let lastKind: ConnectionErrors = 'unknown';
		let lastMessage: string | undefined;
		let lastStatus: number | undefined;

		if (
			!use_proxy &&
			['github.com', 'gitlab.com', 'codeberg.org', 'gitea.com'].some((s) => url.includes(s))
		) {
			clearTimeout(timeout);
			return {
				status: 'fail',
				kind: 'cors',
				message: 'hardcoded not to try due to CORS at domain',
				tried: candidate
			};
		}

		try {
			try {
				const res = await fetch(candidate, {
					method: 'GET',
					mode: 'cors',
					signal: controller.signal
				});

				lastStatus = res.status;

				if (use_proxy && !res.ok) {
					lastKind = 'cors';
					lastMessage = `proxy returned ${res.status}`;
				} else if (!use_proxy && res.status === 404) {
					lastKind = '404';
					lastMessage = 'resource not found';
				} else if (!res.ok) {
					lastKind = 'unknown';
					lastMessage = `http ${res.status}`;
				} else {
					clearTimeout(timeout);
					return { status: 'ok' };
				}
			} catch (err: unknown) {
				if (isAbortError(err)) {
					lastKind = 'timeout';
					lastMessage = 'request aborted (timeout)';
				} else {
					const msg =
						typeof err === 'string'
							? err
							: typeof err === 'object' &&
								  err !== null &&
								  'message' in err &&
								  typeof (err as { message?: unknown }).message === 'string'
								? (err as { message: string }).message
								: String(err);
					lastMessage = msg;
					if (use_proxy || /failed to fetch|cors/i.test(msg)) lastKind = 'cors';
					else if (/network/i.test(msg)) lastKind = 'unknown';
					else lastKind = 'unknown';
				}
			}
		} finally {
			clearTimeout(timeout);
		}

		return {
			status: 'fail',
			kind: lastKind,
			message: lastMessage,
			tried: candidate,
			httpStatus: lastStatus
		};
	};

	const maxRetriesOnTimeout = 2;
	let attempt = 0;
	let lastResult: ConnectionResult | undefined;

	while (attempt <= maxRetriesOnTimeout) {
		lastResult = await tryOnce();
		if (lastResult.status === 'ok') return lastResult;
		if (lastResult.kind !== 'timeout') break;
		// retry only on timeout
		attempt++;
		// small exponential backoff before retrying
		await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
	}

	// return the last result (either non-timeout failure or timeout after retries)
	return lastResult!;
}

export class GitManagerWorker implements GitManagerRpcMethodSigs {
	constructor() {
		this.fs = new LightningFS('git-cache');
	}
	private postEvent(event: GitManagerEvent) {
		self.postMessage({ kind: 'event', ...event });
	}

	fs: LightningFS;

	private getHttp(opts: { remote: string; sub: string }): HttpClient {
		const { remote, sub } = opts;

		return {
			request: async (args: GitHttpRequest): Promise<GitHttpResponse> => {
				const response = await fetch(args.url, {
					method: args.method,
					headers: args.headers as HeadersInit,
					body: args.body as unknown as BodyInit | null
				});

				// Convert Headers to plain object
				const headersObj: Record<string, string> = {};
				response.headers.forEach((value, key) => {
					headersObj[key] = value;
				});

				// Determine total bytes (if provided)
				const contentLength = response.headers.get('content-length');
				const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
				const totalKB = totalBytes ? Math.round(totalBytes / 1024) : undefined;

				// ReadableStream and progress tracking
				const stream = response.body;
				let loadedBytes = 0;

				async function* bodyIterator(this: GitManagerWorker): AsyncIterableIterator<Uint8Array> {
					if (!stream) return;
					const reader = stream.getReader();
					try {
						while (true) {
							const read = await reader.read();
							if (read.done) break;
							const value = read.value ?? new Uint8Array(0);
							const chunkBytes = value.byteLength;
							loadedBytes += chunkBytes;
							const loadedKB = Math.round(loadedBytes / 1024);

							// Log progress; cast this to the surrounding class type as needed
							try {
								this.log({
									remote,
									sub,
									state: 'fetching',
									progress: {
										phase: 'Downloading data',
										loaded: loadedKB,
										total: totalKB
									}
								});
							} catch {
								// ignore logging errors
							}

							yield value;
						}
					} finally {
						try {
							reader.releaseLock();
						} catch {
							/* empty */
						}
					}
				}

				const httpResponse: GitHttpResponse = {
					url: response.url,
					method: args.method,
					statusCode: response.status,
					statusMessage: response.statusText,
					headers: headersObj,
					body: bodyIterator.call(this)
				};

				return httpResponse;
			}
		};
	}

	logs: Map<string, GitManagerLogEntry> = new Map();

	logCatchup(): GitManagerLogEntry[] {
		return Array.from(this.logs.values());
	}

	private log(entry: GitManagerLogEntry) {
		this.logs.set(`${isGitManagerLogEntryServer(entry) ? entry.remote : ''}-${entry.sub}`, entry);
		this.postEvent({ name: 'log', detail: entry });
	}

	a_ref?: RepoRef;
	clone_urls?: string[];
	ref_and_path?: string;
	nostr_state_refs?: string[][];
	connected_remotes: {
		remote: string;
		url: string;
		fetched: boolean;
	}[] = []; // fasted first
	remotes_using_proxy: string[] = [];
	remote_states: Map<string, string[][]> = new Map();
	file_structure?: FileEntry[];
	file_content?: string;
	selected_ref?: { ref: string; commit_id: string };
	selected_path?: SelectedPathInfo;

	private reset(
		a_ref: RepoRef,
		clone_urls: string[],
		nostr_state_refs: string[][] | undefined,
		ref_and_path?: string
	) {
		this.a_ref = a_ref;
		this.clone_urls = [...clone_urls];
		this.nostr_state_refs = nostr_state_refs ? [...nostr_state_refs] : undefined;
		this.ref_and_path = ref_and_path;
		// clear cache
		this.logs = new Map();
		this.connected_remotes = [];
		this.remotes_using_proxy = [];
		this.remote_states = new Map();
		this.file_structure = undefined;
		this.file_content = undefined;
		this.selected_ref = undefined;
		this.selected_path = undefined;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async refreshExplorer(params: object) {
		// Re-send all log events to repopulate git_manager.logs in main thread
		for (const log of this.logs.values()) {
			this.postEvent({ name: 'log', detail: log });
		}

		if (this.nostr_state_refs) {
			this.postEvent({ name: 'stateUpdate', detail: this.nostr_state_refs });
		} else if (this.clone_urls) {
			this.clone_urls.find((url) => {
				const remote = cloneUrlToRemoteName(url);
				const state = this.remote_states.get(remote);
				if (state) {
					this.postEvent({ name: 'stateUpdate', detail: state });
					return true;
				}
				return false;
			});
		}
		if (this.file_content) this.postEvent({ name: 'fileContents', detail: this.file_content });

		if (this.file_structure)
			this.postEvent({ name: 'directoryStructure', detail: this.file_structure });
		if (this.selected_path) this.postEvent({ name: 'selectedPath', detail: this.selected_path });
		await this.refreshSelectedRef(false, true);
	}

	async loadRepository(params: {
		a_ref: RepoRef;
		clone_urls: string[];
		nostr_state_refs?: string[][] | undefined;
		ref_and_path?: string;
	}) {
		const { a_ref, clone_urls, nostr_state_refs, ref_and_path } = params;
		if (a_ref == this.a_ref) return;
		this.fs = new LightningFS('git-cache');
		this.reset(a_ref, clone_urls, nostr_state_refs, ref_and_path);
		if (this.nostr_state_refs) {
			const detail: string[][] = this.nostr_state_refs;
			this.postEvent({ name: 'stateUpdate', detail });
		}
		let already_cloned = false;
		try {
			already_cloned = (await this.fs.promises.readdir(`/${this.a_ref}`)).includes('.git');
		} catch {
			/* empty */
		}
		if (!already_cloned) {
			await git.init({ fs: this.fs, dir: `/${this.a_ref}` });
		} else {
			await this.getRemoteRefsFromLocal();
			await this.refreshSelectedRef();
		}
		await this.addRemotes();
		await this.connectToRemotesAndFetchDefault(already_cloned);
	}

	/// fetch from first connected remote (if fail fallback to the next) then do the rest async
	private async connectToRemotesAndFetchDefault(all_async: boolean) {
		let ready = all_async;
		let cleared_for_early_fetch: string[] = [];
		await Promise.all(
			this.clone_urls?.map(async (url) => {
				const remote = cloneUrlToRemoteName(url);
				const connected = await this.connectToRemote(url);
				if (!connected) return;
				this.connected_remotes.push({ remote, url, fetched: false });

				await new Promise<void>((r) => {
					// eslint-disable-next-line prefer-const
					let int_id: ReturnType<typeof setInterval> | undefined;
					const tryRun = async () => {
						if (
							ready ||
							// start first connected
							cleared_for_early_fetch.length == 0 ||
							cleared_for_early_fetch.includes(url)
						) {
							if (int_id) clearInterval(int_id);
							// mark it as cleared
							if (!cleared_for_early_fetch.includes(url)) cleared_for_early_fetch.push(url);
							// do fetch
							const res = await this.fetchFromRemote(remote);
							await this.refreshSelectedRef();
							// if success we are ready to fetch from all remotes async
							if (typeof res !== 'string') ready = true;
							// if it failed and we arn't ready
							else if (!ready) {
								// clear next connected remote
								const next_one = this.connected_remotes.find(
									(rm) => !cleared_for_early_fetch.includes(rm.url)
								);
								if (next_one) cleared_for_early_fetch.push(next_one.url);
								// if no connecteted remotes empty cleared_for_early_fetch so the next connected remote will start
								else {
									cleared_for_early_fetch = [];
								}
							}
							r();
						}
					};
					int_id = setInterval(tryRun, 50);
					tryRun();
				});
			}) ?? []
		);
	}

	connecting: Set<string> = new Set();
	private async connectToRemote(url: string): Promise<boolean> {
		const remote = cloneUrlToRemoteName(url);
		// don't make multiple conneciton attempts
		if (this.isConnected(url)) return true;
		if (this.connecting.has(url)) {
			return this.awaitConnected(url);
		}

		const result = await httpGitServerConnectionTest(url);

		if (result.status === 'ok') {
			this.log({ remote, state: 'connected' });
			this.connected_remotes.push({ remote, url, fetched: false });
			this.connecting.delete(url);
			return true;
		} else if (result.kind === 'cors') {
			this.log({
				remote,
				state: 'connecting',
				msg: `via proxy as we failed with ${result.kind} error: ${result.message ?? 'unknown'} `
			});
			const proxyResult = await httpGitServerConnectionTest(url, true);

			if (proxyResult.status === 'ok') {
				this.log({ remote, state: 'connected', msg: 'with proxy' });
				this.remotes_using_proxy.push(remote);
				this.connected_remotes.push({ remote, url, fetched: false });
				this.connecting.delete(url);
				return true;
			} else {
				this.log({
					remote,
					state: 'failed',
					msg: `error: ${proxyResult.message ?? 'unknown'}`
				});
				this.connecting.delete(url);
				return false;
			}
		} else {
			this.log({
				remote,
				state: 'failed',
				msg: `failed to connect. ${result.kind} error: ${result.message ?? 'unknown'}`
			});
			this.connecting.delete(url);
			return false;
		}
	}

	private isConnected(url_or_name: string) {
		return this.connected_remotes.some(
			(rmt) => rmt.remote === url_or_name || rmt.url === url_or_name
		);
	}

	private async awaitConnected(url: string): Promise<boolean> {
		return new Promise((r) => {
			const id = setInterval(() => {
				if (!this.connecting.has(url)) {
					clearInterval(id);
					r(this.isConnected(url));
				}
			}, 1);
		});
	}

	/// if url ommited, await fetched from at least remote
	private async awaitFetched(url?: string): Promise<void> {
		return new Promise((r) => {
			const id = setInterval(() => {
				const fetched =
					this.connected_remotes.length > 0 &&
					this.connected_remotes.some((rmt) => rmt.fetched && (!url || rmt.url === url));
				if (fetched) {
					clearInterval(id);
					r();
				}
			}, 1);
		});
	}

	private async fetchFromRemote(
		remote: string,
		remote_ref?: string,
		sub: string = 'explorer'
	): Promise<FetchResult | string> {
		await this.addRemotes(remote); // added as some reports error "The function requires a remote of 'remote OR url' paremeter but none was provied"
		const use_proxy = this.remotes_using_proxy.includes(remote);
		this.log({ remote, state: 'fetching', sub });
		try {
			const res = await git.fetch({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				http: this.getHttp({ remote, sub }),
				remote,
				corsProxy: use_proxy ? cors_proxy_base_url : undefined,
				remoteRef: remote_ref,
				depth: 200, // https://github.com/isomorphic-git/isomorphic-git/issues/1735
				tags: true,
				onProgress: (progress) => {
					this.log({ remote, state: 'fetching', progress, sub });
				}
				// singleBranch: true,
			});
			if (sub == 'explorer' && res.defaultBranch == null)
				throw Error('no default branch, usually a bad sign');
			this.log({ remote, state: 'fetched', sub });
			const state = await this.getRemoteRefsFromLocal(remote);
			if (state && !this.nostr_state_refs && this.clone_urls) {
				// if highest priority (order in clone_url announcement) connected remote use as state
				const top_connected_clone_url = this.clone_urls.find((url) =>
					this.connected_remotes.some((r) => r.url === url && r.fetched)
				);
				if (top_connected_clone_url && cloneUrlToRemoteName(top_connected_clone_url) == remote) {
					const detail: string[][] = state.map((r) => [
						normaliseRemoteRef(r[0]),
						normaliseRemoteRef(r[1])
					]);
					this.postEvent({ name: 'stateUpdate', detail });
				}
			}
			const connected = this.connected_remotes.find((rmt) => rmt.remote === remote);
			if (connected) connected.fetched = true;
			if (sub == 'explorer') this.refreshSelectedRef();
			return res;
		} catch (error) {
			this.log({ remote, state: 'failed', msg: `${error}`, sub });
			return `${error}`;
		}
	}

	private refreshSelectedRef = throttleAsync(
		async (fetch_missing: boolean = false, force_dispatch_event: boolean = false): Promise<void> =>
			this.processRefs(fetch_missing, force_dispatch_event),
		200
	);

	private async processRefs(fetch_missing: boolean, force_dispatch_event: boolean) {
		const ref_paths = await this.waitForDesiredRefPath({
			timeout_ms: 5000,
			interval_ms: 100
		});
		for (const [index, { ref, path, ref_value }] of ref_paths.entries()) {
			try {
				const commit = await git.log({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					ref: ref_value.replace('ref: ', ''),
					depth: 1
				});
				const change_selected_ref =
					!this.selected_ref ||
					this.selected_ref.ref !== ref ||
					this.selected_ref.commit_id !== commit[0].oid;

				const reload_dirs_and_file =
					!this.selected_ref ||
					this.selected_ref.commit_id !== commit[0].oid ||
					!this.selected_path ||
					this.selected_path.path !== path;
				if (change_selected_ref || force_dispatch_event) {
					this.selected_ref = {
						ref,
						commit_id: commit[0].oid
					};
					this.postEvent({
						name: 'selectedRef',
						detail: {
							ref: normaliseRemoteRef(ref, true),
							commit_id: commit[0].oid,
							commit: commit[0].commit,
							is_nostr_ref: index === 0 && !ref.includes('refs/remotes/')
						}
					});
					if (this.publish_commit_infos_from_selected_ref) {
						await this.loadCommitInfosHistory(
							commit[0].oid,
							this.publish_commit_infos_from_selected_ref.count,
							this.publish_commit_infos_from_selected_ref.start_from_depth
						);
					}
				}
				if (reload_dirs_and_file || force_dispatch_event) {
					const short_ref = normaliseRemoteRef(ref, true);
					this.log({
						sub: 'explorer',
						level: 'loading',
						msg: `opening '${short_ref}'`
					});
					await this.loadDirsAndFile(path, short_ref, commit[0].oid);
					this.log({
						sub: 'explorer',
						level: 'info',
						msg: `opened '${short_ref}'`
					});
				}
				// return after first match
				return;
			} catch (e) {
				if (fetch_missing) {
					this.log({
						sub: 'explorer',
						level: 'error',
						msg: `could not find latest ${ref}. fetching from connected remotes. error: ${e}`
					});
					this.connected_remotes.forEach((r) => {
						this.fetchFromRemote(r.remote);
					});
				} else {
					// fetchFromRemote gets all tips so should only get here if nostr_refs aren't avialable on git servers or proccessRefs called before data fetched
				}
			}
		}
	}

	private async loadDirsAndFile(path: string, ref_label: string, commit_id: string) {
		const stillMatches = () => this.selected_ref && this.selected_ref.commit_id == commit_id;
		// update tree
		const res = await this.getPathInfoAndTree(commit_id, path);
		if (!stillMatches()) return;
		if (!res) {
			this.log({ level: 'error', msg: `error loading file tree`, sub: 'explorer' });
			return;
		}
		const { info, tree } = res;
		this.file_structure = tree;
		this.postEvent({ name: 'directoryStructure', detail: tree });

		// update file contents
		const clearFile = () => {
			if (this.file_content) {
				this.file_content = undefined;
				this.postEvent({ name: 'fileContents', detail: undefined });
			}
		};

		// issue new selected path if needed
		if (JSON.stringify(info) !== JSON.stringify(this.selected_path)) {
			this.selected_path = info;
			this.postEvent({
				name: 'selectedPath',
				detail: this.selected_path
			});
			this.file_content = undefined;
		}
		const filepath = getFilePath(this.selected_path);
		if (!filepath) {
			clearFile();
			return;
		}
		if (this.file_content) return;
		try {
			const content = await git.readBlob({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				oid: commit_id,
				filepath
			});
			// Convert Uint8Array to string
			const s = new TextDecoder().decode(content.blob);

			if (this.file_content !== s) {
				this.file_content = s;
				if (s) {
					this.file_content = s;
					this.postEvent({ name: 'fileContents', detail: s });
				} else {
					// TODO how do we indicate error no longer loading file - selectedPath Maybe? how do we know we arn't still loading form other remotes
				}
			}
			return;
		} catch (error) {
			this.log({
				level: 'error',
				msg: `failed to load file contents ${filepath}: ${error}`,
				sub: 'explorer'
			});
		}
	}

	// if ref_and_path undefined this.ref_and_path will be used
	private getDesiredRefPath(ref_and_path?: string) {
		const desired: { ref: string; path: string; ref_value: string }[] = [];
		if (this.nostr_state_refs) {
			if (!ref_and_path && !this.ref_and_path) {
				const d =
					getDefaultBranchRef(this.nostr_state_refs) ?? // use nostr default branch if it exists in state
					getFallbackDefaultBranchRef(this.nostr_state_refs); // fallback to master, main or any branch
				if (d) {
					const r = extractRefAndPath(d, this.nostr_state_refs);
					if (r) desired.push(r);
				}
			} else {
				const r = extractRefAndPath(
					(ref_and_path || this.ref_and_path) as string,
					this.nostr_state_refs
				);
				if (r) desired.push(r);
			}
		}
		this.clone_urls?.forEach((url) => {
			const r = this.getRefAndPathFromRemote(cloneUrlToRemoteName(url), ref_and_path);
			if (r) desired.push(r);
		});
		return desired;
	}
	private async waitForDesiredRefPath({
		timeout_ms = 5000,
		interval_ms = 100
	}: {
		timeout_ms?: number;
		interval_ms?: number;
	} = {}) {
		const start = Date.now();
		while (true) {
			const v = this.getDesiredRefPath();
			if (v.length > 0) return v;
			if (Date.now() - start >= timeout_ms) return [];
			await new Promise((r) => setTimeout(r, interval_ms));
		}
	}

	// if ref_and_path undefined this.ref_and_path will be used
	private getRefAndPathFromRemote(
		remote: string,
		ref_and_path?: string
	): { ref: string; path: string; ref_value: string } | undefined {
		const state = this.remote_states.get(remote);
		if (!state) return;
		// if not specified - use default
		if (!this.ref_and_path) {
			let d: string | undefined = undefined;
			d =
				getDefaultBranchRef(this.nostr_state_refs, remote) ?? // use nostr default branch if it exists in state
				getDefaultBranchRef(state, remote) ?? // fallback to remote default branch
				getFallbackDefaultBranchRef(state, remote); // fallback to master, main or any branch
			const entry = state.find(([r, _v]) => r === d);
			if (d && entry) {
				return { ref: d, path: '', ref_value: entry[1] };
			}
		} else {
			// TODO should we look for the oid as the tip of other branches?
			// if (this.nostr_state_refs) {
			// 	const r = extractRefAndPath(this.ref_and_path, this.nostr_state_refs);
			// 	if (r) {
			// 		let remote_ref = r.ref
			// 			.replace('refs/heads/', `/refs/remotes/${remote}/`)
			// 			.replace('refs/tags/', `/refs/remotes/${remote}/tags/`);

			// 		const entry = state.find(([ref, _v]) => ref === `/refs/remotes/${remote}/${r.ref}`);
			// 		if (entry) return { ...r, ref_value: entry[1] };
			// 	}
			// }
			return extractRefAndPath(ref_and_path || this.ref_and_path, state, remote);
		}
	}

	/// specifiy a remote name to only attempt to add that remote (to ensure it exists)
	private async addRemotes(remote?: string) {
		const remotes = await git.listRemotes({ fs: this.fs, dir: `/${this.a_ref}` });
		for (const url of this.clone_urls ?? []) {
			const remote_name = cloneUrlToRemoteName(url);
			if ((!remote || remote === remote_name) && !remotes.some((r) => r.url === url)) {
				try {
					await git.addRemote({ fs: this.fs, dir: `/${this.a_ref}`, remote: remote_name, url });
					await git.setConfig({
						fs: this.fs,
						dir: `/${this.a_ref}`,
						path: `remote.${remote_name}.fetch`,
						value: `+refs/*:refs/remotes/${remote_name}/*`
					});
				} catch {
					/* empty */
				}
			}
		}
	}

	private async addPrRemote(url: string) {
		const remotes = await git.listRemotes({ fs: this.fs, dir: `/${this.a_ref}` });
		const remote_name = cloneUrlToRemoteName(url);
		if (!remotes.some((r) => r.url === url)) {
			try {
				await git.addRemote({ fs: this.fs, dir: `/${this.a_ref}`, remote: remote_name, url });
				await git.setConfig({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					path: `remote.${remote_name}.fetch`,
					value: `+refs/*:refs/remotes/${remote_name}/*`
				});
			} catch {
				/* empty */
			}
		}
	}

	// if remote_name is ommitted all local remote states will be loaded into this.remote_states
	private async getRemoteRefsFromLocal(remote_name?: string): Promise<string[][] | undefined> {
		if (!remote_name) {
			const remotes = await git.listRemotes({ fs: this.fs, dir: `/${this.a_ref}` });
			await Promise.all(remotes.map((r) => this.getRemoteRefsFromLocal(r.remote)));
			return;
		}
		const fs = this.fs;
		const dir = `/${this.a_ref}`;
		if (!this.connected_remotes || !this.connected_remotes.some((r) => r.remote == remote_name)) {
			return undefined;
		}
		const refs = await git.listRefs({ fs, dir, filepath: `refs/remotes/${remote_name}` });
		const state = await Promise.all(
			refs.map(async (ref) => {
				const v = await git.resolveRef({
					fs,
					dir,
					ref: `refs/remotes/${remote_name}/${ref}`,
					depth: 1
				});
				return [`refs/remotes/${remote_name}/${ref}`, v];
			})
		);
		this.remote_states.set(remote_name, state);
		return state;
	}

	private async getPathInfoAndTree(
		ref: string,
		path: string = ''
	): Promise<{ info: SelectedPathInfo; tree: FileEntry[] } | undefined> {
		const dir = `/${this.a_ref}`;
		try {
			const oid = await git.resolveRef({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				ref
			});
			const files = await git.listFiles({
				fs: this.fs,
				dir,
				ref: oid
			});
			// if path is file, get tree of parent directory
			let dir_path = path;
			if (files.includes(path)) {
				const getParentDir = (path: string) => {
					// Split the path by '/' and remove the last segment
					const segments = path.split('/');
					segments.pop();
					return segments.join('/');
				};
				dir_path = getParentDir(path);
			}
			// Filter files by path and create FileEntry objects with last modified time
			const pathPrefix = dir_path ? `${dir_path}/` : '';
			const filteredFileNames = files
				.filter((file: string) => file.startsWith(pathPrefix))
				.map((file: string) => file.substring(pathPrefix.length))
				.filter((file: string) => file && !file.includes('/')); // Only immediate children

			// Get last modified time for each file
			const filteredFiles: FileEntry[] = [];
			for (const file of filteredFileNames) {
				const filePath = dir_path ? `${dir_path}/${file}` : file;
				let lastModified: Date | undefined;

				// COMMENTED OUT - this is expensive - maybe do this after its loaded when we need this info?

				// try {
				// 	// Get the last commit that modified this file
				// 	const commits = await git.log({
				// 		fs: this.fs,
				// 		dir,
				// 		ref: oid,
				// 		filepath: filePath,
				// 		depth: 3
				// 	});

				// 	if (commits.length > 0) {
				// 		lastModified = new Date(commits[0].commit.committer.timestamp * 1000);
				// 	}
				// } catch (error) {
				// 	// we dont need to use this.log() here as its a warning rather than a failure
				// 	console.warn(`Could not get last modified time for ${filePath}:`, error);
				// }

				filteredFiles.push({
					name: file,
					path: filePath,
					type: 'file' as const,
					lastModified
				});
			}

			// Get directories
			const directories = new Set<string>();
			files
				.filter((file: string) => file.startsWith(pathPrefix))
				.map((file: string) => file.substring(pathPrefix.length))
				.forEach((file: string) => {
					const parts = file.split('/');
					if (parts.length > 1) {
						directories.add(parts[0]);
					}
				});

			// For directories, use the most recent timestamp from files we already processed
			const directoryEntries: FileEntry[] = [];
			for (const dirName of Array.from(directories)) {
				const dirPath = dir_path ? `${dir_path}/${dirName}` : dirName;

				// Find the most recent lastModified time from files in this directory
				let lastModified: Date | undefined;

				// Look at the files we already processed to find ones in this directory
				const filesInThisDir = filteredFiles.filter((file) => {
					const fullFilePath = pathPrefix + file.name;
					return fullFilePath.startsWith(dirPath + '/');
				});

				if (filesInThisDir.length > 0) {
					const validTimestamps = filesInThisDir
						.map((file) => file.lastModified)
						.filter((date): date is Date => date !== undefined);

					if (validTimestamps.length > 0) {
						lastModified = new Date(Math.max(...validTimestamps.map((d) => d.getTime())));
					}
				}

				// If no files with timestamps found, use the repository's most recent commit as fallback
				if (!lastModified) {
					try {
						const commits = await git.log({
							fs: this.fs,
							dir,
							ref,
							depth: 1
						});

						if (commits.length > 0) {
							lastModified = new Date(commits[0].commit.committer.timestamp * 1000);
						}
					} catch {
						// Last resort: use current time
						lastModified = new Date();
					}
				}

				directoryEntries.push({
					name: dirName,
					path: dirPath,
					type: 'directory' as const,
					lastModified
				});
			}

			const tree: FileEntry[] = [...directoryEntries, ...filteredFiles].sort((a, b) => {
				// Directories first, then files
				if (a.type !== b.type) {
					return a.type === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

			const path_is_file = files.includes(path);
			const path_is_dir =
				path == '' || (!path_is_file && files.some((f) => f.startsWith(`${path}/`)));
			const potential_readme_path = path === '' ? 'README.md' : `${path}/README.md`;
			const info: SelectedPathInfo = {
				path,
				exists: path_is_file || path_is_dir,
				path_is_dir,
				readme_path:
					path_is_dir && files.includes(potential_readme_path) ? potential_readme_path : undefined
			};

			return { info, tree };
		} catch (error) {
			this.log({
				level: 'error',
				msg: `failed load dir structure for '${normaliseRemoteRef(ref, true)}': ${error}`,
				sub: 'explorer'
			});
			return undefined;
		}
	}

	async updateNostrState(params: { nostr_state?: string[][] }) {
		const { nostr_state } = params;
		if (this.nostr_state_refs == nostr_state) return;
		this.nostr_state_refs = nostr_state ? [...nostr_state] : undefined;
		this.postEvent({ name: 'stateUpdate', detail: nostr_state || [] });
		// only refresh selected ref if we already have one loaded
		if (this.file_structure) {
			await this.refreshSelectedRef(true);
		}
	}
	async updateCloneUrls(params: { clone_urls: string[] }) {
		const { clone_urls } = params;
		if (this.clone_urls == clone_urls) return;
		// remote old clone urls
		this.clone_urls?.forEach((url) => {
			if (!clone_urls.some((u) => u === url)) {
				this.remote_states.delete(cloneUrlToRemoteName(url));
			}
		});
		// add new clone urls
		await Promise.all(
			clone_urls
				.filter((url) => !this.clone_urls || !this.clone_urls.some((u) => u === url))
				.map(async (url) => {
					const remote = cloneUrlToRemoteName(url);
					try {
						await git.addRemote({ fs: this.fs, dir: `/${this.a_ref}`, remote, url });
					} catch {
						/* empty */
					}
					await git.setConfig({
						fs: this.fs,
						dir: `/${this.a_ref}`,
						path: `remote.${remote}.fetch`,
						value: `+refs/*:refs/remotes/${remote}/*`
					});
					await this.connectToRemote(url);
					await this.fetchFromRemote(remote);
					await this.refreshSelectedRef();
				})
		);
	}

	async updateRefAndPath(params: { ref_and_path?: string }) {
		if (params.ref_and_path == this.ref_and_path) return;
		this.ref_and_path = params.ref_and_path;
		await this.refreshSelectedRef();
	}

	private async fetchPrData(
		event_id: string,
		tip_commit_id: string,
		extra_clone_urls: string[]
	): Promise<boolean> {
		// TODO: we need do to add support to isomorphic git for git.fetch({oids: string[]})
		// for now we should just fetch 'refs/nostr/<event-id>
		const checkForCommit = async () => {
			try {
				const res = await git.log({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					ref: tip_commit_id,
					depth: 1
				});
				if (res.length > 0) return true;
			} catch {
				/* empty*/
			}
			return false;
		};

		const a_ref = this.a_ref;

		const res = await waitForResult(
			async () => {
				if (a_ref !== this.a_ref) return false;
				if (await checkForCommit()) return true;
			},
			async (): Promise<boolean> => {
				const a_ref = this.a_ref;
				this.log({
					level: 'info',
					sub: tip_commit_id,
					msg: 'awaiting default branch fetch'
				});
				await this.awaitFetched();
				let finished_search = false;
				return new Promise((r) => {
					let count = 0;
					const clone_urls = [...(this.clone_urls || [])];
					extra_clone_urls.forEach((c) => {
						if (!clone_urls.includes(c)) clone_urls.push(c);
					});
					const clone_length = clone_urls?.length; // use const here as this.clone_urls can change

					clone_urls.map(async (url) => {
						const remote = cloneUrlToRemoteName(url);
						try {
							if (this.clone_urls?.includes(url)) {
								this.log({
									remote,
									level: 'info',
									sub: tip_commit_id,
									msg: 'awaiting default branch fetch'
								});
								await this.awaitFetched(url);
							} else {
								// test connection
								await this.addPrRemote(url);
								this.log({
									remote,
									level: 'info',
									state: 'connecting',
									sub: tip_commit_id,
									msg: 'remote provided by PR / PR update author'
								});
								const connected = await this.connectToRemote(url);
								if (!connected) {
									this.log({
										remote,
										level: 'error',
										state: 'failed',
										sub: tip_commit_id,
										msg: 'failed to connect to server provided by PR / PR update author'
									});
									return;
								}
								this.log({
									remote,
									level: 'info',
									state: 'connected',
									sub: tip_commit_id,
									msg: 'remote provided by PR / PR update author'
								});
								await this.addPrRemote(url);
							}
							this.log({
								remote,
								level: 'info',
								state: 'fetching',
								sub: tip_commit_id,
								msg: `fetching refs/nostr/${shortenEventId(event_id)}`
							});
							if (finished_search) return;
							if (a_ref !== this.a_ref) return false; // fetch no longer needed
							const res = await this.fetchFromRemote(
								remote,
								`refs/nostr/${event_id}`,
								tip_commit_id
							);
							if (typeof res !== 'string') {
								if (a_ref !== this.a_ref) return r(false); // fetch no longer needed
								if (!(await checkForCommit())) {
									this.log({
										remote,
										level: 'warning',
										state: 'failed',
										sub: tip_commit_id,
										msg: `fetched refs/nostr/${shortenEventId(event_id)} but didn't contain desired commit`
									});
									count++;
									return;
								}
								this.log({
									remote,
									level: 'info',
									state: 'fetched',
									sub: tip_commit_id,
									msg: `refs/nostr/${shortenEventId(event_id)} contains desired commit`
								});
								finished_search = true;
								return r(true);
							} else {
								this.log({
									remote,
									state: 'failed',
									level: 'error',
									sub: tip_commit_id,
									msg: `${res}`
								});
							}
						} catch (e) {
							count++;
							this.log({
								remote,
								state: 'failed',
								level: 'error',
								sub: tip_commit_id,
								msg: `${e}`
							});
							console.log(e);
						}
						if (count == clone_length) r(false);
					});
				});
			},
			{
				intervalMs: 1000,
				timeoutMs: 60_000,
				// sometimes either Pr commit data or defaultTip isn't available straight after fetchPrData
				// maybe a better fix would be for getDefaultTip wait for a bit if unavailable but we are doing it here instead
				finalAttemptDelayMs: 500
			}
		);
		return res || false;
	}

	private async waitForDefaultTip({
		timeout_ms = 5000,
		interval_ms = 100
	}: {
		timeout_ms?: number;
		interval_ms?: number;
	} = {}) {
		const start = Date.now();
		while (true) {
			const v = await this.getDefaultTip();
			if (v) return v;
			if (Date.now() - start >= timeout_ms) return undefined;
			await new Promise((r) => setTimeout(r, interval_ms));
		}
	}

	private async getDefaultTip(): Promise<string | undefined> {
		// Try nostr_state_refs first
		if (this.nostr_state_refs) {
			const defaultRef =
				getDefaultBranchRef(this.nostr_state_refs) ??
				getFallbackDefaultBranchRef(this.nostr_state_refs);
			if (defaultRef) {
				// extra a layer of symref
				let refInfo = extractRefAndPath(defaultRef, this.nostr_state_refs);
				if (refInfo && refInfo.ref_value.includes('ref: ')) {
					refInfo = extractRefAndPath(
						refInfo.ref_value.replace('ref: ', ''),
						this.nostr_state_refs
					);
				}
				if (refInfo) {
					try {
						const commit = await git.log({
							fs: this.fs,
							dir: `/${this.a_ref}`,
							ref: refInfo.ref_value,
							depth: 1
						});
						if (commit.length > 0) return commit[0].oid;
					} catch {
						/* empty */
					}
				}
			}
		}

		// Fall back to remote states
		for (const url of this.clone_urls || []) {
			const remote = cloneUrlToRemoteName(url);
			const state = this.remote_states.get(remote);

			if (state) {
				const defaultRef =
					getDefaultBranchRef(state, remote) ?? getFallbackDefaultBranchRef(state, remote);
				if (defaultRef) {
					// extra a layer of symref
					let refInfo = extractRefAndPath(defaultRef, state);
					if (refInfo && refInfo.ref_value.includes('ref: ')) {
						refInfo = extractRefAndPath(refInfo.ref_value.replace('ref: ', ''), state);
					}
					if (refInfo) {
						try {
							const commit = await git.log({
								fs: this.fs,
								dir: `/${this.a_ref}`,
								ref: refInfo.ref_value,
								depth: 1
							});
							if (commit.length > 0) return commit[0].oid;
						} catch {
							/* empty */
						}
					}
				}
			}
		}

		return undefined;
	}

	private async loadPrCommitInfo(tip_commit_id: string): Promise<CommitInfo[] | undefined> {
		const default_tip = await this.getDefaultTip();
		if (!default_tip) return undefined;
		try {
			// 1) find merge base(s)
			const bases = await git.findMergeBase({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				oids: [tip_commit_id, default_tip]
			});
			const baseSet = new Set(bases); // may be empty

			if (baseSet.has(tip_commit_id)) {
				this.log({
					level: 'warning',
					sub: tip_commit_id,
					msg: 'This PR was merged via fast-forward. Only the tip commit at this point of time is shown; the total number of commits is unknown.'
				});
				const log = await git.log({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					ref: tip_commit_id,
					depth: 0
				});
				return log.slice(0, 1).map((e) => ({ oid: e.oid, ...e.commit }));
			}

			// 2) collect oids reachable from tip_commit_id until any base (exclude base)
			const seen = new Set<string>();
			const collected = new Set<string>();
			const stack: string[] = [tip_commit_id];

			while (stack.length) {
				const oid = stack.pop()!;
				if (!oid) continue;
				if (seen.has(oid)) continue;
				seen.add(oid);
				if (baseSet.has(oid)) continue;
				collected.add(oid);
				const { commit }: ReadCommitResult = await git.readCommit({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					oid
				});
				for (const p of commit.parent) stack.push(p);
			}

			if (collected.size === 0) return [];

			// 3) get ordered log (newest->oldest), filter to collected, then reverse to ancestor-first
			const log = await git.log({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				ref: tip_commit_id,
				depth: 100
			});

			const filtered = log.filter((e) => collected.has(e.oid)).reverse(); // now oldest -> newest

			return filtered.map((e) => ({ oid: e.oid, ...e.commit }));
		} catch {
			return undefined;
		}
	}

	async getPrCommitInfos(params: {
		event_id_listing_tip: string;
		tip_commit_id: string;
		extra_clone_urls: string[];
	}): Promise<CommitInfo[] | undefined> {
		const { event_id_listing_tip, tip_commit_id, extra_clone_urls } = params;
		return await waitForResult<CommitInfo[]>(
			() => this.loadPrCommitInfo(tip_commit_id),
			async () => {
				await this.fetchPrData(event_id_listing_tip, tip_commit_id, extra_clone_urls);
				await this.waitForDefaultTip({
					timeout_ms: 20_000,
					interval_ms: 200
				});
			},
			{
				intervalMs: 1000,
				timeoutMs: 60_000,
				// sometimes either Pr commit data or defaultTip isn't available straight after fetchPrData
				// maybe a better fix would be for getDefaultTip wait for a bit if unavailable but we are doing it here instead
				finalAttemptDelayMs: 500
			}
		);
	}

	// returns a diff string showing whats changed since the base commit
	private async loadDiffBetween(
		base_commit_id: string,
		tip_commit_id: string
	): Promise<string | undefined> {
		try {
			// Get the trees for both commits
			const [baseCommit, tipCommit] = await Promise.all([
				git.readCommit({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					oid: base_commit_id
				}),
				git.readCommit({
					fs: this.fs,
					dir: `/${this.a_ref}`,
					oid: tip_commit_id
				})
			]);

			// Walk through both trees to find differences
			const baseTree = baseCommit.commit.tree;
			const tipTree = tipCommit.commit.tree;

			// Get all file paths from both trees
			const baseFiles = await this.getFilesFromTree(baseTree);
			const tipFiles = await this.getFilesFromTree(tipTree);

			// Create a set of all unique file paths
			const allPaths = new Set([...baseFiles.keys(), ...tipFiles.keys()]);

			// Generate diff output
			let diffOutput = '';

			for (const path of allPaths) {
				const baseFile = baseFiles.get(path);
				const tipFile = tipFiles.get(path);

				if (!baseFile && tipFile) {
					// File was added
					const content = await this.readBlobContent(tipFile.oid);
					diffOutput += this.formatFileDiff(path, null, content);
				} else if (baseFile && !tipFile) {
					// File was deleted
					const content = await this.readBlobContent(baseFile.oid);
					diffOutput += this.formatFileDiff(path, content, null);
				} else if (baseFile && tipFile && baseFile.oid !== tipFile.oid) {
					// File was modified
					const [baseContent, tipContent] = await Promise.all([
						this.readBlobContent(baseFile.oid),
						this.readBlobContent(tipFile.oid)
					]);
					diffOutput += this.formatFileDiff(path, baseContent, tipContent);
				}
			}

			return diffOutput || undefined;
		} catch (error) {
			this.log({ level: 'error', msg: `Error generating diff: ${error}` });
			return undefined;
		}
	}

	private async getFilesFromTree(
		treeOid: string
	): Promise<Map<string, { oid: string; mode: string }>> {
		const files = new Map<string, { oid: string; mode: string }>();

		const walkTree = async (oid: string, prefix: string = '') => {
			const tree = await git.readTree({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				oid
			});

			for (const entry of tree.tree) {
				const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path;

				if (entry.type === 'tree') {
					await walkTree(entry.oid, fullPath);
				} else if (entry.type === 'blob') {
					files.set(fullPath, { oid: entry.oid, mode: entry.mode });
				}
			}
		};

		await walkTree(treeOid);
		return files;
	}

	private async readBlobContent(oid: string): Promise<Uint8Array> {
		try {
			const { blob } = await git.readBlob({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				oid
			});
			return blob;
		} catch {
			return new Uint8Array();
		}
	}

	private formatFileDiff(
		path: string,
		oldBytes: Uint8Array | null,
		newBytes: Uint8Array | null
	): string {
		const decode = (b: Uint8Array | null) => {
			if (!b) return '';
			let s = new TextDecoder('utf-8', { fatal: false }).decode(b);
			if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
			return s.replace(/\r\n/g, '\n');
		};

		const oldText = oldBytes ? decode(oldBytes) : '';
		const newText = newBytes ? decode(newBytes) : '';

		// createPatch already emits file headers and hunks
		const patch = createPatch(path, oldText, newText, '', '', { context: 3 });

		// Optionally prepend git-style headers you want to keep
		return patch;
	}

	private async loadPrDiff(tip_commit_id: string): Promise<string | undefined> {
		const default_tip = await this.getDefaultTip();
		if (!default_tip) return undefined;
		const bases = await git.findMergeBase({
			fs: this.fs,
			dir: `/${this.a_ref}`,
			oids: [tip_commit_id, default_tip]
		});
		if (bases.length === 0) return undefined;
		const baseSet = new Set(bases);

		if (baseSet.has(tip_commit_id)) {
			this.log({
				level: 'warning',
				sub: tip_commit_id,
				msg: 'This PR was merged via fast-forward. Only showing changes from the tip commit; the total diff is unknown.'
			});
			return this.loadCommitDiff(tip_commit_id);
		}

		return this.loadDiffBetween(bases[0], tip_commit_id);
	}

	async getPrDiff(params: {
		event_id_listing_tip: string;
		tip_commit_id: string;
		extra_clone_urls: string[];
	}): Promise<string | undefined> {
		const { event_id_listing_tip, tip_commit_id, extra_clone_urls } = params;
		const diff = await this.loadPrDiff(tip_commit_id);
		if (diff) return diff;
		// see comment in this.getPrCommitInfos about defect in getDefaultTip
		const fetched = await this.fetchPrData(event_id_listing_tip, tip_commit_id, extra_clone_urls);
		if (!fetched) return undefined; // cant fetch pr data
		return this.loadPrDiff(tip_commit_id);
	}

	private async loadCommitDiff(commit_id: string): Promise<string | undefined> {
		try {
			const commitData = await git.readCommit({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				oid: commit_id
			});
			const commit = commitData.commit;
			const parents = commit.parent || [];

			if (parents.length === 0) {
				// Root commit: diff against empty tree — use a synthetic "empty" base
				// Create a special sentinel id for an empty tree (null) and handle it in loadDiffBetween,
				// or call loadDiffBetween with a fake base that your helper understands.
				// Simpler: produce added files by reusing loadDiffBetween with an empty tree oid if you can
				// else fall back to manual behavior:
				const tipTree = commit.tree;
				const tipFiles = await this.getFilesFromTree(tipTree);
				let diffOutput = '';
				for (const [path, tipFile] of tipFiles) {
					const tipContent = await this.readBlobContent(tipFile.oid);
					diffOutput += this.formatFileDiff(path, null, tipContent);
				}
				return diffOutput || undefined;
			}

			// Use first parent and reuse loadDiffBetween
			const parentOid = parents[0];
			return await this.loadDiffBetween(parentOid, commit_id);
		} catch (error) {
			this.log({ level: 'error', msg: `Error generating commit diff: ${error}` });
			return undefined;
		}
	}

	async getCommitDiff(params: {
		commit_id: string;
		event_id_ref_hint?: string;
		extra_clone_urls?: string[];
	}): Promise<string | undefined> {
		const { commit_id, event_id_ref_hint, extra_clone_urls } = params;
		const diff = await this.loadCommitDiff(commit_id);
		if (diff) return diff;
		if (!event_id_ref_hint) return undefined;
		// see comment in this.getPrCommitInfos about defect in getDefaultTip
		const fetched = await this.fetchPrData(event_id_ref_hint, commit_id, extra_clone_urls || []);
		if (!fetched) return undefined; // cant fetch pr data
		return this.loadCommitDiff(commit_id);
	}

	publish_commit_infos_from_selected_ref?: { count: number; start_from_depth: number };

	async listenForRecentCommitsInfos(
		params: { count: number; start_from_depth: number } = {
			count: 20,
			start_from_depth: 0
		}
	) {
		this.publish_commit_infos_from_selected_ref = { ...params };
		if (this.selected_ref) {
			await this.loadCommitInfosHistory(
				this.selected_ref.commit_id,
				this.publish_commit_infos_from_selected_ref.count,
				this.publish_commit_infos_from_selected_ref.start_from_depth
			);
		}
	}

	private async loadCommitInfosHistory(
		tip_commit_id: string,
		count: number = 20,
		start_from_depth: number = 0
	) {
		try {
			const log = await git.log({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				ref: tip_commit_id,
				depth: count + start_from_depth
			});
			const infos = log.slice(start_from_depth).map((e) => ({ oid: e.oid, ...e.commit }));
			this.postEvent({ name: 'recentCommitsInfos', detail: infos });

			return infos;
		} catch {
			return undefined;
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async stopListeningForRecentCommitsInfos(params: object) {
		this.publish_commit_infos_from_selected_ref = undefined;
	}
}

function getDefaultBranchRef(state?: string[][], remote?: string): string | undefined {
	const h = state?.find(
		(r) =>
			r.length > 1 &&
			(r[0] === 'HEAD' || r[0] === `refs/remotes/${remote}/HEAD`) &&
			r[1].startsWith('ref: ')
	);
	if (h) {
		const b = h[1].replace('ref: ', '');
		if (remote && b.startsWith('refs/heads/')) {
			return makeRefRemoteSpecific(b, remote);
		}
		return b;
	}
}

function getFallbackDefaultBranchRef(state?: string[][], remote?: string): string | undefined {
	let h = state?.find(
		(r) =>
			r.length > 1 &&
			(r[0] === 'refs/heads/master' || r[0] === `refs/remotes/${remote}/heads/master`)
	);
	if (!h) {
		h = state?.find(
			(r) =>
				r.length > 1 && (r[0] === 'refs/heads/main' || r[0] === `refs/remotes/${remote}/heads/main`)
		);
	}
	if (!h) {
		h = state?.find(
			(r) =>
				r.length > 0 &&
				(r[0].startsWith('refs/heads/') || r[0].startsWith(`refs/remotes/${remote}/heads/`))
		);
	}
	if (h) {
		if (remote && h[0].startsWith('refs/heads/')) {
			return makeRefRemoteSpecific(h[0], remote);
		}
		return h[0];
	}
}

// return undefined if no matching ref exists in state
function extractRefAndPath(
	ref_and_path: string,
	state: string[][],
	remote?: string
): { ref: string; path: string; ref_value: string } | undefined {
	// add prefix found in state
	if (!ref_and_path.startsWith('refs/')) ref_and_path = `refs/heads/${ref_and_path}`; // eg. master to refs/heads/master
	if (remote) {
		ref_and_path = makeRefRemoteSpecific(ref_and_path, remote);
	}

	// Initialize variables to hold the longest ref and the path
	let longestRef = '';
	let ref_value = '';
	let path = '';

	// Iterate through the possible refs
	for (const r of state) {
		// Check if the ref is in the parts
		if (ref_and_path.startsWith(r[0]) && r[0].length > longestRef.length) {
			longestRef = r[0];
			ref_value = r[1];
		}
	}
	// If a longest ref was found, construct the path
	if (longestRef.length > 0) {
		path = ref_and_path.replace(longestRef, '');
		if (path.charAt(0) === '/') {
			path = path.slice(1);
		}
	} else return undefined;

	// Return the result or null if no ref was found
	return longestRef ? { ref: longestRef, path, ref_value } : undefined;
}

// also works for symbolic refs eg 'ref: refs/remotes/123/heads/main' ~> 'ref: refs/heads/main'
function normaliseRemoteRef(ref: string, shorten: boolean = false): string {
	const update = ref
		// replace refs/remotes/[hex-string]/ with refs/heads/
		.replace(/^refs\/remotes\/[0-9a-f]+\/(.*)$/, 'refs/$1');
	if (shorten) return update.replace('refs/heads/', '').replace('refs/tags/', 'tags/');
	return update;
}

function makeRefRemoteSpecific(ref: string, remote: string): string {
	// eg refs/heads/master to refs/remotes/123/master or refs/tags/v0.1 to refs/remotes/123/tags/v0.1
	return ref.replace('refs/', `refs/remotes/${remote}/`);
}

function getFilePath(selected_path?: SelectedPathInfo): string | undefined {
	if (selected_path) {
		if (selected_path.readme_path) return selected_path.readme_path;
		if (!selected_path.path_is_dir && selected_path.exists) return selected_path.path;
	}
}

function shortenEventId(event_id: string): string {
	if (typeof event_id !== 'string') return '';
	if (event_id.length < 10) return event_id;
	return event_id.slice(0, 5) + '...' + event_id.slice(-5);
}

type AsyncFn<T> = () => Promise<T | undefined>;

type WaitOpts = {
	intervalMs?: number;
	timeoutMs?: number;
	finalAttemptDelayMs?: number; // optional delay before the final attempt after trigger (ms)
};

/**
 * Wait for loader to return a defined value. Starts polling immediately,
 * runs trigger (if provided) and then tries loader once after trigger resolves,
 * waits finalAttemptDelayMs (if provided) and tries once more, and gives up after timeoutMs.
 */
async function waitForResult<T>(
	localLoader: AsyncFn<T>,
	longRunningFetcher?: () => Promise<unknown>,
	opts?: WaitOpts
): Promise<T | undefined> {
	const intervalMs = opts?.intervalMs ?? 500;
	const timeoutMs = opts?.timeoutMs ?? 60_000;
	const finalAttemptDelayMs = opts?.finalAttemptDelayMs ?? 0;

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let intervalHandle: ReturnType<typeof setInterval> | undefined;
	let settled = false;

	const res = await localLoader();
	if (res) return res;

	const clearAll = () => {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (intervalHandle) clearInterval(intervalHandle);
	};

	const timeoutPromise = new Promise<T | undefined>((resolve) => {
		timeoutHandle = setTimeout(() => {
			if (!settled) {
				settled = true;
				clearAll();
				resolve(undefined);
			}
		}, timeoutMs);
	});

	const intervalPromise = new Promise<T | undefined>((resolve) => {
		intervalHandle = setInterval(() => {
			localLoader()
				.then((r) => {
					if (r !== undefined && !settled) {
						settled = true;
						clearAll();
						resolve(r);
					}
				})
				.catch(() => {
					/* ignore loader errors */
				});
		}, intervalMs);

		// immediate attempt without waiting for first interval
		localLoader()
			.then((r) => {
				if (r !== undefined && !settled) {
					settled = true;
					clearAll();
					resolve(r);
				}
			})
			.catch(() => {
				/* ignore */
			});
	});

	const triggerPromise = new Promise<T | undefined>((resolve) => {
		if (!longRunningFetcher) return;
		longRunningFetcher()
			.catch(() => {
				/* ignore trigger errors */
			})
			.then(async () => {
				if (settled) return;
				// attempt immediately after trigger
				try {
					const r = await localLoader();
					if (r !== undefined && !settled) {
						settled = true;
						clearAll();
						resolve(r);
						return;
					}
				} catch {
					// ignore
				}

				// optional final attempt delay, then try once more
				if (finalAttemptDelayMs > 0) {
					await new Promise((res) => setTimeout(res, finalAttemptDelayMs));
				}

				if (settled) return;
				try {
					const r2 = await localLoader();
					if (!settled) {
						settled = true;
						clearAll();
						resolve(r2);
					}
				} catch {
					if (!settled) {
						settled = true;
						clearAll();
						resolve(undefined);
					}
				}
			});
	});

	const result = (await Promise.race([timeoutPromise, intervalPromise, triggerPromise])) as
		| T
		| undefined;

	clearAll();
	return result;
}

// Generic typed throttle for async functions.
// Runs immediately if interval elapsed; when a call occurs during a running execution
// a single trailing call with the latest args will be scheduled.
function throttleAsync<Args extends unknown[], R>(
	fn: (...args: Args) => Promise<R>,
	interval: number
) {
	let lastRun = 0;
	let running = false;
	let scheduledTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let latestArgs: Args | null = null;

	const wrapper = async (...args: Args): Promise<R | void> => {
		const now = Date.now();
		latestArgs = args;

		if (running) {
			if (scheduledTimer == null) {
				scheduledTimer = globalThis.setTimeout(() => {
					scheduledTimer = null;
					void wrapper(...(latestArgs as Args));
				}, interval);
			}
			return;
		}

		const canRunNow = now - lastRun >= interval;
		if (!canRunNow) {
			if (scheduledTimer == null) {
				const wait = interval - (now - lastRun);
				scheduledTimer = globalThis.setTimeout(() => {
					scheduledTimer = null;
					void wrapper(...(latestArgs as Args));
				}, wait);
			}
			return;
		}

		running = true;
		lastRun = Date.now();
		try {
			return await fn(...args);
		} finally {
			running = false;
		}
	};

	return wrapper;
}

const git_manager = new GitManagerWorker();

function errToMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'string') return e;
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
}
// RPC handler
self.onmessage = async (ev) => {
	const msg = ev.data;
	if (!msg || typeof msg !== 'object') return;
	const { id, action, params } = msg as { id?: unknown; action?: unknown; params?: unknown };
	if (typeof id !== 'number') return;
	try {
		if (action === 'call') {
			// we do no checks to ensure the methodParams are correct, we rely on the typings
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (!params || typeof params !== 'object' || typeof (params as any).method !== 'string') {
				self.postMessage({ id, ok: false, error: { message: 'malformed-params' } });
				return;
			}
			const { method, params: methodParams } = params as { method: string; params?: unknown };
			if (!isGitManagerMethod(method)) {
				self.postMessage({ id, ok: false, error: { message: 'no-such-method' } });
				return;
			}
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const result = await (git_manager as any)[method](methodParams);
				self.postMessage({ id, ok: true, result });
			} catch (e) {
				self.postMessage({ id, ok: false, error: { message: errToMessage(e) } });
			}
		} else if (action === 'getState') {
			self.postMessage({
				id,
				ok: true,
				result: {
					logs: Array.from(git_manager.logs.values()),
					a_ref: git_manager.a_ref,
					clone_urls: git_manager.clone_urls
				}
			});
		} else {
			self.postMessage({ id, ok: false, error: 'unknown-action' });
		}
	} catch (err: unknown) {
		self.postMessage({ id, ok: false, error: errToMessage(err) });
	}
};
