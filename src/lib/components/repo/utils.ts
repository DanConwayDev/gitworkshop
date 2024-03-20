import type { RepoCollection, RepoEvent } from './type'

export const selectRepoFromCollection = (
  collection: RepoCollection
): RepoEvent | undefined => {
  if (collection.selected_event_id && collection.selected_event_id.length > 0)
    return collection.events.find(
      (e) => e.event_id === collection.selected_event_id
    )

  return [...collection.events].sort((a, b) => {
    const a_ref = a.referenced_by ? a.referenced_by.length : 0
    const b_ref = b.referenced_by ? b.referenced_by.length : 0
    if (a_ref === b_ref) return b.created_at - a.created_at
    return b_ref - a_ref
  })[0]
}

export const extractGithubDetails = (
  clone: string
): { org: string; repo_name: string } | undefined => {
  if (clone.indexOf('github.') > -1) {
    const g_split = clone.split('github.')
    if (g_split.length > 0) {
      const final = g_split[1].replace(':', '/').split('/')
      if (final.length > 2) {
        return {
          org: final[1],
          repo_name: final[2].split('.')[0],
        }
      }
    }
  }
  return undefined
}
