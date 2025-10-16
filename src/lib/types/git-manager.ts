import type { CommitObject } from 'isomorphic-git';
import type { RepoRef } from './git';

// Git Types

export interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
	mode?: string;
	lastModified?: Date;
}

export interface SelectedPathInfo {
	path: string;
	exists: boolean;
	path_is_dir: boolean;
	readme_path?: string;
}

export interface SelectedRefInfo {
	ref: string;
	commit_id: string;
	commit: CommitObject;
	is_nostr_ref: boolean;
}

export interface GitManagerLogEntryServer {
	remote: string;
	state: GitServerState;
	msg?: string;
	progress?: GitProgressObj;
	sub?: string;
}
export interface GitManagerLogEntryGlobal {
	level: 'info' | 'loading' | 'warning' | 'error';
	msg: string;
	sub?: string;
}
export type GitServerState = 'connecting' | 'connected' | 'fetching' | 'fetched' | 'failed';

export type GitManagerLogEntry = GitManagerLogEntryServer | GitManagerLogEntryGlobal;

export interface GitServerStatus {
	short_name: string;
	state: GitServerState;
	with_proxy: boolean;
	msg?: string;
	progress?: GitProgressObj;
}

export type GitProgressPhase =
	| 'Counting objects'
	| 'Compressing objects'
	| 'Downloading data' // note we get this from http not, onProgress
	| 'Receiving objects'
	| 'Resolving deltas'
	| string;

// GitProgressEvent with optional total and typed
export interface GitProgressObj {
	phase: GitProgressPhase;
	total: number | undefined;
	loaded: number;
}

export function isGitManagerLogEntryServer(x?: GitManagerLogEntry): x is GitManagerLogEntryServer {
	return !!x && Object.keys(x).includes('remote');
}
export function isGitManagerLogEntryGlobal(x?: GitManagerLogEntry): x is GitManagerLogEntryGlobal {
	return !!x && !Object.keys(x).includes('remote');
}

export interface CommitInfo extends CommitObject {
	oid: string;
}

export type GitManagerEvent =
	| { name: 'log'; detail: GitManagerLogEntry }
	| { name: 'stateUpdate'; detail: string[][] }
	| { name: 'fileContents'; detail?: string }
	| { name: 'directoryStructure'; detail: FileEntry[] }
	| { name: 'selectedPath'; detail: SelectedPathInfo }
	| { name: 'selectedRef'; detail: SelectedRefInfo }
	| { name: 'recentCommitsInfos'; detail: CommitInfo[] };

export const RPC_METHODS = [
	'loadRepository',
	'refreshExplorer',
	'updateNostrState',
	'updateCloneUrls',
	'updateRefAndPath',
	'getPrCommitInfos',
	'getPrDiff',
	'getCommitDiff',
	'listenForRecentCommitsInfos',
	'stopListeningForRecentCommitsInfos'
] as const;

export function isGitManagerMethod(method: string): method is GitManagerRpcMethodNames {
	return (RPC_METHODS as readonly string[]).includes(method);
}

export type GitManagerRpcMethodNames = (typeof RPC_METHODS)[number];

type Req = {
	loadRepository: {
		params: {
			a_ref: RepoRef;
			clone_urls: string[];
			nostr_state_refs?: string[][];
			ref_and_path?: string;
		};
		result: Promise<void>;
	};
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	refreshExplorer: { params: {}; result: Promise<void> };
	updateNostrState: { params: { nostr_state?: string[][] }; result: Promise<void> };
	updateCloneUrls: { params: { clone_urls: string[] }; result: Promise<void> };
	updateRefAndPath: { params: { ref_and_path?: string }; result: Promise<void> };
	getPrCommitInfos: {
		params: { event_id_listing_tip: string; tip_commit_id: string; extra_clone_urls: string[] };
		result: Promise<CommitInfo[] | undefined>;
	};
	getPrDiff: {
		params: { event_id_listing_tip: string; tip_commit_id: string; extra_clone_urls: string[] };
		result: Promise<string | undefined>;
	};
	getCommitDiff: {
		params: { commit_id: string; event_id_ref_hint?: string; extra_clone_urls?: string[] };
		result: Promise<string | undefined>;
	};

	listenForRecentCommitsInfos: {
		params: {
			count: number;
			start_from_depth: number;
		};
		result: Promise<void>;
	};
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	stopListeningForRecentCommitsInfos: { params: {}; result: Promise<void> };
};

// Force Req to have exactly the keys from RPC_METHODS (no missing keys).
// If you add a name to RPC_METHODS, TypeScript will error until you add it to Req.
// Note typescript wont catch removals with this
export type GitManagerRpcMethodInfo = Req &
	Record<Exclude<GitManagerRpcMethodNames, keyof Req>, never>;

export type GitManagerRpcMethodSigs = {
	[K in GitManagerRpcMethodNames]: (
		params: GitManagerRpcMethodInfo[K]['params']
	) => GitManagerRpcMethodInfo[K]['result'];
};
