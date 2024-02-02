export const load = ({ params }) => {
  return {
    repo_id: params.repo_id,
    pr_id: params.pr_id,
  }
}
