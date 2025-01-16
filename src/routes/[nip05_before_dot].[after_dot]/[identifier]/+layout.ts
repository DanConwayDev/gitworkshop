export const load = ({
	params
}: {
	params: { nip05_before_dot: string; after_dot: string; identifier: string };
}) => {
	return {
		nip05: `${params.nip05_before_dot}.${params.after_dot}`,
		identifier: params.identifier
	};
};
