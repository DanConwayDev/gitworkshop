import { extractRepoRoute } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { repo_route: string } }) => {
	const repo_route = extractRepoRoute(params.repo_route);
	// params.repo_route is also a catch all for other routes
	const invalid_route = params.repo_route;
	// redirects
	if (!repo_route && invalid_route.startsWith('r/')) {
		redirect(301, `/${invalid_route.replace(new RegExp(`^r\\/`), '')}`);
	}

	return { repo_route };
};
