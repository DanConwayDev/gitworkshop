import { extractRepoRoute } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load = ({ params, url }: { params: { repo_route: string }; url: string }) => {
	const repo_route = extractRepoRoute(params.repo_route);
	// params.repo_route is also a catch all for other routes
	const invalid_route = params.repo_route;
	const url_string = url.toString();
	// pages with repo sidebar
	const with_repo_sidebar = ['', '/about', '/issues', '/prs', '/actions'].some((page) =>
		url_string.endsWith(`${repo_route?.s}${page}`)
	);
	const show_sidebar_on_moible = ['', '/about'].some((page) =>
		url_string.endsWith(`${repo_route?.s}${page}`)
	);

	// redirects
	if (!repo_route && invalid_route.startsWith('r/')) {
		redirect(301, `/${invalid_route.replace(new RegExp(`^r\\/`), '')}`);
	}

	return { url: url_string, repo_route, with_repo_sidebar, show_sidebar_on_moible };
};
