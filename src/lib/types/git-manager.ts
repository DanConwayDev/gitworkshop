// Git Types
export interface Repository {
	a_ref: string;
	cloneUrls: string[];
	branches: string[];
	tags: string[];
	defaultBranch: string;
	lastUpdated: Date;
}

export interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
	mode?: string;
	lastModified?: Date;
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
