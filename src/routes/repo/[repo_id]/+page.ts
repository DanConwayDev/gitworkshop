export const load = ({ params }) => {
  return {
    repo_id: decodeURIComponent(params.repo_id),
  }
}
