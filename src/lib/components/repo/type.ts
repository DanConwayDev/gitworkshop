import {
  defaults as user_defaults,
  type User,
  type UserObject,
} from '../users/type'

export interface RepoEventBase {
  event_id: string
  naddr: string
  author: string // pubkey
  identifier: string
  unique_commit: string | undefined
  name: string
  description: string
  clone: string[]
  web: string[]
  tags: string[]
  maintainers: string | User[]
  relays: string[]
  referenced_by: string[]
  // this is unreliable as relays dont return youngest first
  most_recent_reference_timestamp: number
  created_at: number
  loading: boolean
}
export interface RepoEvent extends RepoEventBase {
  maintainers: string[]
}

export interface RepoEventWithMaintainersMetadata extends RepoEventBase {
  maintainers: UserObject[]
}

export const event_defaults: RepoEvent = {
  event_id: '',
  naddr: '',
  author: '',
  identifier: '',
  unique_commit: '',
  name: '',
  description: '',
  clone: [],
  web: [],
  tags: [],
  maintainers: [],
  relays: [],
  referenced_by: [],
  most_recent_reference_timestamp: 0,
  created_at: 0,
  loading: true,
}

export interface RepoCollectionBase {
  selected_a: string // <kind>:<pubkeyhex>:<identifier>
  most_recent_index: number
  maintainers: string | User[]
  events: RepoEvent[]
  loading: boolean
}

export interface RepoCollection extends RepoCollectionBase {
  maintainers: string[]
}

export interface RepoCollectionWithMaintainersMetadata
  extends RepoCollectionBase {
  maintainers: UserObject[]
}

export const collection_defaults: RepoCollection = {
  selected_a: '',
  most_recent_index: -1,
  maintainers: [],
  events: [],
  loading: true,
}

export interface RepoSummary {
  name: string
  description: string
  identifier: string
  naddr: string
  unique_commit: string | undefined
  maintainers: User[]
  loading?: boolean
  created_at: number
  most_recent_reference_timestamp: number
}
export const summary_defaults: RepoSummary = {
  name: '',
  identifier: '',
  naddr: '',
  unique_commit: undefined,
  description: '',
  maintainers: [{ ...user_defaults }],
  loading: false,
  created_at: 0,
  most_recent_reference_timestamp: 0,
}

export interface SelectedPubkeyRepoCollections {
  pubkey: string
  collections: RepoCollection[]
}

export interface RepoDIdentiferCollection {
  d: string
  events: RepoEvent[]
  loading: boolean
}

export interface RepoRecentCollection {
  events: RepoEvent[]
  loading: boolean
}

export type RepoPage = 'about' | 'issues' | 'proposals'

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
