import git, { type ReadCommitResult } from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import type { Repository, FileEntry, Commit, GitError } from '$lib/types/git-manager';
import { Buffer as BufferPolyfill } from 'buffer';
// required for isomorphic-git with vite
declare var Buffer: typeof BufferPolyfill;
globalThis.Buffer = BufferPolyfill;

export class GitManager {
	fs: LightningFS;
	private cache: Map<string, any> = new Map();

	constructor() {
		this.fs = new LightningFS('git-cache');
	}

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

	// Repository Operations
	async cloneRepository(
		url: string,
		a_ref: string,
		options: { singleBranch?: boolean; ref?: string; proxy?: boolean } = {}
	): Promise<Repository> {
		const dir = `/${a_ref}`;
		const { singleBranch = true, ref, proxy = false } = options;

		try {
			// Check if repository already exists in cache
			const cacheKey = `/${a_ref}`;
			if (this.cache.has(cacheKey)) {
				return this.cache.get(cacheKey);
			}

			// Clone repository with shallow clone for performance
			const cloneOptions: any = {
				fs: this.fs,
				http: {
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
				},
				dir,
				url,
				depth: 1,
				noCheckout: true,
				singleBranch,
				corsProxy: proxy ? 'https://cors.isomorphic-git.org' : undefined
			};

			// Add ref if specified (branch to clone)
			if (ref) {
				cloneOptions.ref = ref;
			}

			await git.clone(cloneOptions);

			// Get repository metadata
			const branches = await this.getBranches(dir);
			const defaultBranch = await this.getDefaultBranch(dir, branches);

			const repository: Repository = {
				a_ref,
				cloneUrls: [url],
				branches,
				defaultBranch,
				lastUpdated: new Date()
			};

			// Cache the repository
			this.cache.set(cacheKey, repository);

			return repository;
		} catch (error) {
			console.error('Failed to clone repository:', error);
			throw this.createGitError('clone', error);
		}
	}

	async getRepository(a_ref: string): Promise<Repository | null> {
		const cacheKey = `/${a_ref}`;
		return this.cache.get(cacheKey) || null;
	}

	async isRepositoryCloned(a_ref: string): Promise<boolean> {
		const dir = `/${a_ref}`;
		try {
			// Check if the repository directory exists and has a .git folder
			const files = await this.fs.promises.readdir(dir);
			return files.includes('.git');
		} catch (error) {
			// Directory doesn't exist or is not accessible
			return false;
		}
	}

	async loadRepositoryFromFilesystem(a_ref: string): Promise<Repository | null> {
		const isCloned = await this.isRepositoryCloned(a_ref);
		if (!isCloned) {
			return null;
		}

		const dir = `/${a_ref}`;
		try {
			// Get repository metadata from the filesystem
			const branches = await this.getBranches(dir);
			const defaultBranch = await this.getDefaultBranch(dir);

			// Create a basic repository object
			const repository: Repository = {
				a_ref,
				cloneUrls: [], // Will be populated from Nostr data
				branches,
				defaultBranch,
				lastUpdated: new Date()
			};

			// Cache the repository for future use
			const cacheKey = `/${a_ref}`;
			this.cache.set(cacheKey, repository);

			return repository;
		} catch (error) {
			console.error('Failed to load repository from filesystem:', error);
			return null;
		}
	}

	async pullRepository(
		a_ref: string,
		branch: string = 'master',
		proxy: boolean = false
	): Promise<void> {
		const dir = `/${a_ref}`;

		try {
			// Fetch latest changes from remote
			await git.fetch({
				fs: this.fs,
				http: {
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
				},
				dir,
				corsProxy: proxy ? 'https://cors.isomorphic-git.org' : undefined,
				ref: branch,
				singleBranch: true
			});

			// Merge/fast-forward the changes
			await git.merge({
				fs: this.fs,
				dir,
				ours: branch,
				theirs: `origin/${branch}`,
				fastForwardOnly: false
			});

			console.log(`Successfully pulled updates for ${a_ref} on branch ${branch}`);
		} catch (error) {
			console.error('Failed to pull repository updates:', error);
			throw this.createGitError('pull', error);
		}
	}

	async getLatestCommitHash(a_ref: string, branch: string = 'master'): Promise<string | null> {
		const dir = `/${a_ref}`;

		try {
			const oid = await git.resolveRef({
				fs: this.fs,
				dir,
				ref: branch
			});
			return oid;
		} catch (error) {
			console.error('Failed to get latest commit hash:', error);
			return null;
		}
	}

	async getBranches(dir: string): Promise<string[]> {
		const branches = await git.listBranches({
			fs: this.fs,
			dir
		});
		return branches;
	}

	async getDefaultBranch(dir: string, all_branches?: string[]): Promise<string> {
		try {
			// Try to get the default branch from HEAD
			const head = await git.resolveRef({
				fs: this.fs,
				dir,
				ref: 'HEAD'
			});

			// If HEAD points to a branch, extract the branch name
			if (head.startsWith('refs/heads/')) {
				return head.replace('refs/heads/', '');
			}
		} catch {
			/* empty */
		}
		let branches = all_branches || (await this.getBranches(dir));
		if (branches.includes('master')) return 'master';
		if (branches.includes('main')) return 'main';
		if (branches[0]) return branches[0];
		throw Error('no branches available');
	}

	async getFileTree(
		a_ref: string,
		branch: string = 'master',
		path: string = ''
	): Promise<FileEntry[]> {
		const dir = `/${a_ref}`;

		try {
			const files = await git.listFiles({
				fs: this.fs,
				dir,
				ref: branch
			});

			// Filter files by path and create FileEntry objects with last modified time
			const pathPrefix = path ? `${path}/` : '';
			const filteredFileNames = files
				.filter((file: string) => file.startsWith(pathPrefix))
				.map((file: string) => file.substring(pathPrefix.length))
				.filter((file: string) => file && !file.includes('/')); // Only immediate children

			// Get last modified time for each file
			const filteredFiles: FileEntry[] = [];
			for (const file of filteredFileNames) {
				const filePath = path ? `${path}/${file}` : file;
				let lastModified: Date | undefined;

				try {
					// Get the last commit that modified this file
					const commits = await git.log({
						fs: this.fs,
						dir,
						ref: branch,
						filepath: filePath,
						depth: 1
					});

					if (commits.length > 0) {
						lastModified = new Date(commits[0].commit.committer.timestamp * 1000);
					}
				} catch (error) {
					// If we can't get the commit history, skip the timestamp
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
				const dirPath = path ? `${path}/${dirName}` : dirName;

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
							ref: branch,
							depth: 1
						});

						if (commits.length > 0) {
							lastModified = new Date(commits[0].commit.committer.timestamp * 1000);
						}
					} catch (error) {
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

			return [...directoryEntries, ...filteredFiles].sort((a, b) => {
				// Directories first, then files
				if (a.type !== b.type) {
					return a.type === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
		} catch (error) {
			console.error('Failed to get file tree:', error);
			throw this.createGitError('listFiles', error);
		}
	}

	async getFileContent(a_ref: string, branch: string, filePath: string): Promise<string> {
		const dir = `/${a_ref}`;

		try {
			// First resolve the branch to get the commit ID
			const oid = await git.resolveRef({
				fs: this.fs,
				dir,
				ref: branch
			});

			const content = await git.readBlob({
				fs: this.fs,
				dir,
				oid,
				filepath: filePath
			});

			// Convert Uint8Array to string
			return new TextDecoder().decode(content.blob);
		} catch (error) {
			console.error('Failed to get file content:', error);
			throw this.createGitError('readFile', error);
		}
	}

	async getFileBinaryContent(a_ref: string, branch: string, filePath: string): Promise<Uint8Array> {
		const dir = `/${a_ref}`;

		try {
			// First resolve the branch to get the commit ID
			const oid = await git.resolveRef({
				fs: this.fs,
				dir,
				ref: branch
			});

			const content = await git.readBlob({
				fs: this.fs,
				dir,
				oid,
				filepath: filePath
			});

			// Return raw binary data
			return content.blob;
		} catch (error) {
			console.error('Failed to get binary file content:', error);
			throw this.createGitError('readBinaryFile', error);
		}
	}

	async getCommitHistory(
		a_ref: string,
		branch: string = 'master',
		limit: number = 50
	): Promise<Commit[]> {
		const dir = `/${a_ref}`;

		try {
			const commits = await git.log({
				fs: this.fs,
				dir,
				ref: branch,
				depth: limit
			});

			return commits.map(
				(commit: ReadCommitResult): Commit => ({
					hash: commit.oid,
					author: {
						name: commit.commit.author.name,
						email: commit.commit.author.email,
						timestamp: commit.commit.author.timestamp
					},
					committer: {
						name: commit.commit.committer.name,
						email: commit.commit.committer.email,
						timestamp: commit.commit.committer.timestamp
					},
					message: commit.commit.message,
					parents: commit.commit.parent || []
				})
			);
		} catch (error) {
			console.error('Failed to get commit history:', error);
			throw this.createGitError('log', error);
		}
	}

	async getCommitDetails(a_ref: string, commitHash: string): Promise<Commit | null> {
		const dir = `/${a_ref}`;

		try {
			const commits = await git.log({
				fs: this.fs,
				dir,
				ref: commitHash,
				depth: 1
			});

			if (commits.length === 0) return null;

			const commit = commits[0];
			return {
				hash: commit.oid,
				author: {
					name: commit.commit.author.name,
					email: commit.commit.author.email,
					timestamp: commit.commit.author.timestamp
				},
				committer: {
					name: commit.commit.committer.name,
					email: commit.commit.committer.email,
					timestamp: commit.commit.committer.timestamp
				},
				message: commit.commit.message,
				parents: commit.commit.parent || []
			};
		} catch (error) {
			console.error('Failed to get commit details:', error);
			return null;
		}
	}

	// CORS Error Detection
	async testRepositoryAccess(url: string): Promise<boolean> {
		try {
			// Try a simple HTTP request to test CORS
			const response = await fetch(url + '/info/refs?service=git-upload-pack', {
				method: 'GET',
				mode: 'cors'
			});
			return response.ok;
		} catch (error) {
			console.error('CORS test failed:', error);
			return false;
		}
	}

	// Cache Management
	clearCache(): void {
		indexedDB.deleteDatabase('git-cache');
	}

	getCacheSize(): number {
		return this.cache.size;
	}

	// Helper Methods
	private createGitError(operation: string, originalError: any): GitError {
		const error = new Error(`Git ${operation} failed: ${originalError.message}`) as GitError;
		error.type = 'git';
		error.operation = operation;
		error.details = originalError;
		return error;
	}

	// Repository cleanup
	async removeRepository(a_ref: string): Promise<void> {
		const cacheKey = `/${a_ref}`;

		try {
			// Remove from cache
			this.cache.delete(cacheKey);

			// Remove from filesystem (if needed for cleanup)
			// Note: LightningFS doesn't have a direct rmdir method
			// The data will be cleared when the browser cache is cleared
		} catch (error) {
			console.error('Failed to remove repository:', error);
		}
	}
}
