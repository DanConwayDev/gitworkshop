import type { User } from '../users/type'
import { defaults as user_defaults } from '../users/type'
import type { Event } from '../events/type'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

export interface IssueSummary {
  type: 'issue'
  title: string
  descritpion: string
  repo_a: string
  id: string
  comments: number
  status: undefined | number
  status_date: number
  author: User
  created_at: number | undefined
  loading: boolean
}

export const summary_defaults: IssueSummary = {
  type: 'issue',
  title: '',
  descritpion: '',
  repo_a: '',
  id: '',
  comments: 0,
  status: undefined,
  status_date: 0,
  author: { ...user_defaults },
  created_at: 0,
  loading: true,
}

export interface IssueSummaries {
  repo_a: string | undefined
  summaries: IssueSummary[]
  loading: boolean
}

export const summaries_defaults: IssueSummaries = {
  repo_a: '',
  summaries: [],
  loading: true,
}

export interface IssueFull {
  summary: IssueSummary
  issue_event: NDKEvent | undefined
  labels: string[]
  events: Event[]
  loading: boolean
}

export const full_defaults: IssueFull = {
  summary: { ...summary_defaults },
  issue_event: undefined,
  labels: [],
  events: [],
  loading: true,
}
