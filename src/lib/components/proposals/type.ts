import type { User } from '../users/type'
import { defaults as user_defaults } from '../users/type'
import type { Event } from '../events/type'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

export interface ProposalSummary {
  type: 'proposal'
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

export const summary_defaults: ProposalSummary = {
  type: 'proposal',
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

export interface ProposalSummaries {
  repo_a: string | undefined
  summaries: ProposalSummary[]
  loading: boolean
}

export const summaries_defaults: ProposalSummaries = {
  repo_a: '',
  summaries: [],
  loading: true,
}

export interface ProposalFull {
  summary: ProposalSummary
  proposal_event: NDKEvent | undefined
  labels: string[]
  events: Event[]
  loading: boolean
}

export const full_defaults: ProposalFull = {
  summary: { ...summary_defaults },
  proposal_event: undefined,
  labels: [],
  events: [],
  loading: true,
}
