export const load = ({
  params,
}: {
  params: { issue_id: string; repo_id: string }
}) => {
  return {
    repo_id: decodeURIComponent(params.repo_id),
    issue_id: params.issue_id,
  }
}
