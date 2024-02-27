export const load = ({
  params,
}: {
  params: { proposal_id: string; repo_id: string }
}) => {
  return {
    repo_id: decodeURIComponent(params.repo_id),
    proposal_id: params.proposal_id,
  }
}
