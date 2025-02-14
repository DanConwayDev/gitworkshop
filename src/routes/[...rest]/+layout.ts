import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { rest: string }; }): { rest: string } => {
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
	return { rest: params.rest };
};
