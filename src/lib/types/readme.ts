/** most servers will produce a CORS error so a proxy should be used */
export const cloneArrayToReadMeUrls = (clone: string[]): string[] => {
	const addresses = clone.map(extractRepoAddress);
	/**
	 * at the time of this commit these urls work for:
	 * self-hosted gitea (or forgejo), gitlab
	 * github.com
	 * bitbucket.org
	 * gitlab.org
	 * gitea.com
	 * codeberg.org (forgejo instance)
	 * sourcehut (git.sr.ht)
	 * launchpad.net
	 * It doesnt work for:
	 * self-hosted gogs (requires branch name repo/raw/master/README.md)
	 * sourceforge.net (https://sourceforge.net/p/mingw/catgets/ci/master/tree/README?format=raw)
	 * notabug.org (requires branch name notabug.org/org/repo/raw/master/README.md)
	 */
	return [
		...addresses.flatMap((address) => {
			let prefix = 'raw/HEAD';
			if (address.includes('sr.ht')) prefix = 'blob/HEAD';
			if (address.includes('git.launchpad.net') || address.includes('git.savannah.gnu.org'))
				prefix = 'plain';
			if (address.includes('github.com')) {
				// raw.githubusercontent.com can be used without CORS error
				address = address.replace('github.com', 'raw.githubusercontent.com');
				prefix = 'HEAD';
			}
			return ['README.md', 'readme.md'].map(
				(filename) => `https://${address}/${prefix}/${filename}`
			);
		})
	];
};

const extractRepoAddress = (clone_string: string): string => {
	let s = clone_string;
	// remove trailing slash
	if (s.endsWith('/')) s = s.substring(0, s.length - 1);
	// remove trailing .git
	if (s.endsWith('.git')) s = s.substring(0, s.length - 4);
	// remove :// and anything before
	if (s.includes('://')) s = s.split('://')[1];
	// remove @ and anything before
	if (s.includes('@')) s = s.split('@')[1];
	// replace : with /
	s = s.replace(/\s|:[0-9]+/g, '');
	s = s.replace(':', '/');
	return s;
};
