export const load = ({
	params,
	url
}: {
	params: { rest: string };
	url: string;
}): { params: { rest: string } } => {
	return {
		params
	};
};
