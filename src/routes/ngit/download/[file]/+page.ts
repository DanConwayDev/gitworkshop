import { NGIT_VERSION } from '$lib/constants';
import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { file: string } }): { file: string } => {
	let version = NGIT_VERSION;

	['ubuntu', 'macos', 'windows'].forEach((os) => {
		const s = params.file.split(`ngit-latest-${os}-`);
		if (s[1] && s[1].length > 0) {
			redirect(
				301,
				`https://github.com/DanConwayDev/ngit-cli/releases/download/${version}/ngit-${version}-${os}-${s[1]}`
			);
		}
	});

	redirect(301, `/not-found`);
};
