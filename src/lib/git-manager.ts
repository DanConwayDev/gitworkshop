import git, { type FetchResult, type HttpClient } from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import type {
	FileEntry,
	GitManagerLogEntry,
	SelectedPathInfo,
	SelectedRefInfo
} from '$lib/types/git-manager';
import { Buffer as BufferPolyfill } from 'buffer';
import { cloneUrlToRemoteName } from './git-utils';
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
				console.log(err);
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
}

export class GitManager extends EventTarget {
	constructor() {
		super();
		this.fs = new LightningFS('git-cache');
	}

	fs: LightningFS;
	// for isomorphic-git
	http: HttpClient = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		request: async (args: any) => {
			const response = await fetch(args.url, {
				method: args.method,
				headers: args.headers,
				body: args.body
			});

			// Convert Headers to plain object
			const headers: { [key: string]: string } = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});

			// Convert ReadableStream to AsyncIterableIterator
			const body = response.body ? this.streamToAsyncIterator(response.body) : undefined;

			return {
				url: response.url,
				method: args.method,
				statusCode: response.status,
				statusMessage: response.statusText,
				body,
				headers
			};
		}
	};

	// Helper method to convert ReadableStream to AsyncIterableIterator
	private async *streamToAsyncIterator(
		stream: ReadableStream<Uint8Array>
	): AsyncIterableIterator<Uint8Array> {
		const reader = stream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				yield value;
			}
		} finally {
			reader.releaseLock();
		}
	}

	private log(entry: GitManagerLogEntry) {
		this.dispatchEvent(new CustomEvent<GitManagerLogEntry>('log', { detail: entry }));
	}

	a_ref?: string;
	clone_urls?: string[];
	ref_and_path?: string;
	nostr_state_refs?: string[][];
	connected_remotes: {
		remote: string;
		url: string;
	}[] = []; // fasted first
	remotes_using_proxy: string[] = [];
	remote_states: Map<string, string[][]> = new Map();
	file_structure?: FileEntry[];
	file_content?: string;
	selected_ref?: { ref: string; commit_id: string };
	selected_path?: SelectedPathInfo;

	private reset(
		a_ref: string,
		clone_urls: string[],
		nostr_state_refs: string[][] | undefined,
		ref_and_path?: string
	) {
		this.a_ref = a_ref;
		this.clone_urls = [...clone_urls];
		this.nostr_state_refs = nostr_state_refs ? [...nostr_state_refs] : undefined;
		this.ref_and_path = ref_and_path;
		// clear cache
		this.connected_remotes = [];
		this.remotes_using_proxy = [];
		this.remote_states = new Map();
		this.file_structure = undefined;
		this.file_content = undefined;
		this.selected_ref = undefined;
		this.selected_path = undefined;
	}

	async loadRepository(
		a_ref: string,
		clone_urls: string[],
		nostr_state_refs: string[][] | undefined,
		ref_and_path?: string
	) {
		if (a_ref === this.a_ref) return;
		this.fs = new LightningFS('git-cache');
		this.reset(a_ref, clone_urls, nostr_state_refs, ref_and_path);
		if (this.nostr_state_refs) {
			const detail: string[][] = this.nostr_state_refs;
			this.dispatchEvent(new CustomEvent<string[][]>('stateUpdate', { detail }));
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
			this.refreshSelectedRef();
		}
		await this.addRemotes();
		let fetched_from_one_remote = already_cloned;
		await Promise.all(
			this.clone_urls?.map(async (url) => {
				const remote = cloneUrlToRemoteName(url);
				this.log({ remote, state: 'connecting' });

				const result = await httpGitServerConnectionTest(url);

				if (result.status === 'ok') {
					this.log({ remote, state: 'connected' });
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
					} else {
						this.log({
							remote,
							state: 'failed',
							msg: `error: ${proxyResult.message ?? 'unknown'}`
						});
						return;
					}
				} else {
					this.log({
						remote,
						state: 'failed',
						msg: `failed to connect. ${result.kind} error: ${result.message ?? 'unknown'}`
					});
					return;
				}
				this.connected_remotes.push({ remote, url });
				// only do a full fetch (like clone) from first connected remote
				if (already_cloned || this.connected_remotes.length === 1) {
					await this.fetchFromRemote(remote);
					fetched_from_one_remote = true;
				} else {
					// wait until first connected remote has finished fetchFromRemote before proceeding to fetchFromRemote(remote)
					await new Promise<void>((r) => {
						const id = setTimeout(async () => {
							if (fetched_from_one_remote) {
								clearTimeout(id);
								await this.fetchFromRemote(remote);
								r();
							}
						}, 1);
					});
				}
			}) ?? []
		);
	}
	private async fetchFromRemote(
		remote: string,
		remote_ref?: string
	): Promise<FetchResult | string> {
		await this.addRemotes(remote); // added as some reports error "The function requires a remote of 'remote OR url' paremeter but none was provied"
		const use_proxy = this.remotes_using_proxy.includes(remote);
		this.log({ remote, state: 'fetching' });
		try {
			const res = await git.fetch({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				http: this.http,
				remote,
				corsProxy: use_proxy ? cors_proxy_base_url : undefined,
				remoteRef: remote_ref,
				depth: 1, // https://github.com/isomorphic-git/isomorphic-git/issues/1735
				tags: true
				// singleBranch: true,
			});
			this.log({ remote, state: 'fetched' });
			const state = await this.getRemoteRefsFromLocal(remote);
			if (state && !this.nostr_state_refs && this.clone_urls) {
				// if highest priority (order in clone_url announcement) connected remote use as state
				const top_connected_clone_url = this.clone_urls.find((url) =>
					this.connected_remotes.some((r) => r.url === url)
				);
				if (top_connected_clone_url && cloneUrlToRemoteName(top_connected_clone_url) == remote) {
					const detail: string[][] = state.map((r) => [
						normaliseRemoteRef(r[0]),
						normaliseRemoteRef(r[1])
					]);
					this.dispatchEvent(new CustomEvent<string[][]>('stateUpdate', { detail }));
				}
			}
			this.refreshSelectedRef();
			return res;
		} catch (error) {
			this.log({ remote, state: 'failed', msg: `fetch error: ${error}` });
			return `${error}`;
		}
	}

	private async ensureRemoteExists() {}

	private async refreshSelectedRef(fetch_missing: boolean = false) {
		const ref_paths = this.getDesiredRefPath();
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
				if (change_selected_ref) {
					this.selected_ref = {
						ref,
						commit_id: commit[0].oid
					};
					this.dispatchEvent(
						new CustomEvent<SelectedRefInfo>('selectedRef', {
							detail: {
								ref: normaliseRemoteRef(ref, true),
								commit_id: commit[0].oid,
								commit: commit[0].commit,
								is_nostr_ref: index === 0 && !ref.includes('refs/remotes/')
							}
						})
					);
				}
				if (reload_dirs_and_file) {
					this.loadDirsAndFile(path, normaliseRemoteRef(ref, true), commit[0].oid);
				}
				return; // use first match (most desirable ref that we have the blobs for)
			} catch (e) {
				if (fetch_missing) {
					this.log({ level: 'error', msg: `TODO - fix this missing ref: ${ref}: error: ${e}` });
					console.log(`error: couldnt resolve ${ref} - need to fetch it. error: ${e}`);
					// fetchFromRemote gets all tips, so we should only get here when nostr_state_refs changes and we need a new fetch
					// TODO - try and fetch for git severs - we need to be careful not to create a infinate loop of fetching from git servers when the nost refs aren't available
				} else {
					// fetchFromRemote gets all tips so should only get here if nostr_refs aren't avialable on git servers
					this.log({ level: 'error', msg: `missing ref: ${ref}: error: ${e}` });
					console.log(`error: couldnt resolve ${ref} - need to fetch it. error: ${e}`);
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
			this.log({ level: 'error', msg: `error loading file tree` });
			return;
		}
		const { info, tree } = res;
		this.file_structure = tree;
		this.dispatchEvent(new CustomEvent<FileEntry[]>('directoryStructure', { detail: tree }));

		// update file contents
		const clearFile = () => {
			if (this.file_content) {
				this.file_content = undefined;
				this.dispatchEvent(
					new CustomEvent<string | undefined>('fileContents', { detail: undefined })
				);
			}
		};

		// issue new selected path if needed
		if (JSON.stringify(info) !== JSON.stringify(this.selected_path)) {
			this.selected_path = info;
			this.dispatchEvent(
				new CustomEvent<SelectedPathInfo>('selectedPath', {
					detail: this.selected_path
				})
			);
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
					this.dispatchEvent(new CustomEvent<string | undefined>('fileContents', { detail: s }));
				} else {
					// TODO how do we indicate error no longer loading file - selectedPath Maybe? how do we know we arn't still loading form other remotes
				}
			}
			return;
		} catch (error) {
			this.log({ level: 'error', msg: `failed to load file contents ${filepath}: ${error}` });
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
				} catch {
					/* empty */
				}
			}
			await git.setConfig({
				fs: this.fs,
				dir: `/${this.a_ref}`,
				path: `remote.${remote_name}.fetch`,
				value: `+refs/*:refs/remotes/${remote_name}/*`
			});
		}
	}

	private async getRemoteRefsFromLocal(remote_name: string): Promise<string[][] | undefined> {
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
		this.log({
			level: 'error',
			msg: `fectching file structure for '${normaliseRemoteRef(ref, true)}'`
		});
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

				try {
					// Get the last commit that modified this file
					const commits = await git.log({
						fs: this.fs,
						dir,
						ref: oid,
						filepath: filePath,
						depth: 3
					});

					if (commits.length > 0) {
						lastModified = new Date(commits[0].commit.committer.timestamp * 1000);
					}
				} catch (error) {
					// we dont need to use this.log() here as its a warning rather than a failure
					console.warn(`Could not get last modified time for ${filePath}:`, error);
				}

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
				msg: `failed load dir structure for '${normaliseRemoteRef(ref, true)}': ${error}`
			});
			return undefined;
		}
	}

	updateNostrState(nostr_state?: string[][]) {
		this.nostr_state_refs = nostr_state ? [...nostr_state] : undefined;
		// do stuff
		this.dispatchEvent(new CustomEvent<string[][]>('stateUpdate', { detail: nostr_state }));

		this.refreshSelectedRef(true);
	}
	async updateCloneUrls(clone_urls: string[]) {
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
					this.fetchFromRemote(remote);
				})
		);
		await this.refreshSelectedRef();
	}

	updateRefAndPath(ref_and_path?: string) {
		if (ref_and_path == this.ref_and_path) return;
		this.ref_and_path = ref_and_path;
		this.refreshSelectedRef();
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
	if (shorten) return update.replace('ref/heads/', '').replace('refs/tags/', 'tags/');
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
