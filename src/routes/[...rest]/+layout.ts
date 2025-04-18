import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { rest: string } }): { rest: string } => {
	// redirects
	if (params.rest.startsWith('r/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^r\\/`), '')}`);
	}
	if (params.rest.startsWith('p/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^p\\/`), '')}`);
	}
	if (params.rest.startsWith('e/')) {
		redirect(301, `/${params.rest.replace(new RegExp(`^e\\/`), '')}`);
	}
	if (params.rest.startsWith('repos')) {
		redirect(301, `/search`);
	}
	if (params.rest.startsWith('repo/')) {
		redirect(301, `/${params.rest.substring(5).replace('/proposal/', '/prs/')}`);
	}
	if (params.rest === 'install' || params.rest === 'install/') {
		redirect(301, `/ngit`);
	}
	return { rest: params.rest };
};
