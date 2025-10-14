import type { CommitObject, GitProgressEvent } from 'isomorphic-git';
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
	level: 'info' | 'warning' | 'error';
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
	progress?: GitProgressEvent;
}

export type GitProgressPhase =
	| 'Counting objects'
	| 'Compressing objects'
	| 'Receiving objects'
	| 'Resolving deltas'
	| string;
export interface GitProgressObj extends GitProgressEvent {
	phase: GitProgressPhase;
}

export function isGitManagerLogEntryServer(x?: GitManagerLogEntry): x is GitManagerLogEntryServer {
	return !!x && Object.keys(x).includes('remote');
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
	| { name: 'selectedRef'; detail: SelectedRefInfo };

export const RPC_METHODS = [
	'loadRepository',
	'refreshExplorer',
	'updateNostrState',
	'updateCloneUrls',
	'updateRefAndPath',
	'getPrCommitInfos',
	'getPrDiff',
	'getCommitDiff'
] as const;

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
