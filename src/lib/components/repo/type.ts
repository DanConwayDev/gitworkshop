import { defaults as user_defaults, type User } from '../users/type'

export interface Repo {
  repo_id: string
  unique_commit: string | undefined
  name: string
  description: string
  clone: string
  tags: string[]
  maintainers: User[]
  relays: string[]
  loading: boolean
}
export const defaults: Repo = {
  repo_id: '',
  unique_commit: '',
  name: '',
  description: '',
  clone: '',
  tags: [],
  maintainers: [],
  relays: [],
  loading: true,
}

export interface RepoSummary {
  name: string
  description: string
  repo_id: string
  maintainers: User[]
  loading?: boolean
  created_at: number
}
export const summary_defaults: RepoSummary = {
  name: '',
  repo_id: '',
  description: '',
  maintainers: [{ ...user_defaults }],
  loading: false,
  created_at: 0,
}
