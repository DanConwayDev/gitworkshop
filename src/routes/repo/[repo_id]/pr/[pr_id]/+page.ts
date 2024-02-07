export const load = ({ params }) => {
  return {
    repo_id: decodeURIComponent(params.repo_id),
    pr_id: params.pr_id,
  }
}
