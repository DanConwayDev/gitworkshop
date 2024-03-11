import { defaults as user_defaults, type User } from '../users/type'

export interface RepoEvent {
  event_id: string
  naddr: string
  identifier: string
  unique_commit: string | undefined
  name: string
  description: string
  clone: string
  web: string[]
  tags: string[]
  maintainers: User[]
  relays: string[]
  referenced_by: string[]
  created_at: number
  loading: boolean
}
export const event_defaults: RepoEvent = {
  event_id: '',
  naddr: '',
  identifier: '',
  unique_commit: '',
  name: '',
  description: '',
  clone: '',
  web: [],
  tags: [],
  maintainers: [],
  relays: [],
  referenced_by: [],
  created_at: 0,
  loading: true,
}

export interface RepoCollection {
  selected_event_id: string
  unique_commit: string
  identifier: string
  events: RepoEvent[]
  loading: boolean
}

export const collection_defaults: RepoCollection = {
  identifier: '',
  unique_commit: '',
  selected_event_id: '',
  events: [],
  loading: true,
}

export interface RepoSummary {
  name: string
  description: string
  identifier: string
  unique_commit: string | undefined
  maintainers: User[]
  loading?: boolean
  created_at: number
}
export const summary_defaults: RepoSummary = {
  name: '',
  identifier: '',
  unique_commit: undefined,
  description: '',
  maintainers: [{ ...user_defaults }],
  loading: false,
  created_at: 0,
}

export interface RepoReadme {
  md: string
  loading: boolean
  failed: boolean
}

export const readme_defaults: RepoReadme = {
  md: '',
  loading: true,
  failed: false,
}
