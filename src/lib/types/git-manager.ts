import type { CommitObject } from 'isomorphic-git';

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
}

export interface GitManagerLogEntryServer {
	remote: string;
	state: GitServerState;
	msg?: string;
}
export interface GitManagerLogEntryGlobal {
	level: 'info' | 'warning' | 'error';
	msg: string;
}
export type GitServerState = 'connecting' | 'fetching' | 'connected' | 'failed';

export type GitManagerLogEntry = GitManagerLogEntryServer | GitManagerLogEntryGlobal;

export interface GitServerStatus {
	short_name: string;
	state: GitServerState;
	with_proxy: boolean;
	msg?: string;
}

export function isGitManagerLogEntryServer(x?: GitManagerLogEntry): x is GitManagerLogEntryServer {
	return !!x && Object.keys(x).includes('remote');
}
