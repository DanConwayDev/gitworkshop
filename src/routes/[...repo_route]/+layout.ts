import { extractRepoRoute, extractUserRoute, type RouteData } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load = ({
	params,
	url
}: {
	params: { repo_route: string };
	url: string;
}): RouteData | undefined => {
	const url_string = url.toString();

	const repo_route = extractRepoRoute(params.repo_route);
	if (repo_route) {
		// pages with repo sidebar
		const with_repo_sidebar = ['', '/about', '/issues', '/prs', '/actions'].some((page) =>
			url_string.endsWith(`${repo_route?.s}${page}`)
		);
		const show_sidebar_on_mobile = ['', '/about'].some((page) =>
			url_string.endsWith(`${repo_route?.s}${page}`)
		);

		return { url: url_string, repo_route, with_repo_sidebar, show_sidebar_on_mobile };
	}

	// params.repo_route is also a catch all for other routes
	const not_valid_repo_route = params.repo_route;

	const user_route = extractUserRoute(not_valid_repo_route);
	if (user_route) {
		// user sub-routes cannot be used as would be interpreted as a repo identifier
		return { url: url_string, user_route };
	}

	// not repo_route or user_route at this point
	// redirects
	if (not_valid_repo_route.startsWith('r/')) {
		redirect(301, `/${not_valid_repo_route.replace(new RegExp(`^r\\/`), '')}`);
	}
	if (not_valid_repo_route.startsWith('p/')) {
		redirect(301, `/${not_valid_repo_route.replace(new RegExp(`^p\\/`), '')}`);
	}
};
