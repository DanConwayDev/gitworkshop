// Git Types
export interface Repository {
	a_ref: string;
	cloneUrls: string[];
	refs: [[string, string]];
	checkedout_ref: string;
	checked_out_file: string | undefined;
	checked_out_file_contents: string;
	log: string[];

	branches: string[];
	tags: string[];
	defaultBranch: string;
	lastUpdated: Date;
}

export interface ManagedGitRepo {
	a_ref: string;
	clone_urls: string[];
	refs: [string, string][] | undefined;
	HEAD_ref: string | undefined;
	file_path: string | undefined;
	file_contents: string | undefined;
	log: { status: string | undefined; remotes: { [remote: string]: string | undefined } };
}

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

export interface Commit {
	hash: string;
	author: {
		name: string;
		email: string;
		timestamp: number;
	};
	committer: {
		name: string;
		email: string;
		timestamp: number;
	};
	message: string;
	parents: string[];
}

// Error Types
export interface CORSError extends Error {
	type: 'cors';
	repositoryUrl: string;
	maintainers: string[];
}

export interface GitError extends Error {
	type: 'git';
	operation: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	details?: any;
}
