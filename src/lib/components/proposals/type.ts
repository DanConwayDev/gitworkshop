import type { TreeEvent } from '../events/type'
import type { Event } from 'nostr-tools'
import type { PubKeyString } from '$lib/dbs/types'

export interface ProposalSummary {
  type: 'proposal'
  title: string
  descritpion: string
  repo_a: string
  id: string
  comments: number
  status: undefined | number
  status_date: number
  author: PubKeyString | undefined
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
  author: undefined,
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
  proposal_event: Event | undefined
  labels: string[]
  events: TreeEvent[]
  loading: boolean
}

export const full_defaults: ProposalFull = {
  summary: { ...summary_defaults },
  proposal_event: undefined,
  labels: [],
  events: [],
  loading: true,
}
