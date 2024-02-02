import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { PRSummary } from './type'
import { UserVectors } from '../users/vectors'

dayjs.extend(relativeTime)

const Short = {
  title: 'short title',
  author: { ...UserVectors.default },
  created_at: dayjs().subtract(7, 'days').unix(),
  comments: 2,
  status: 'Open',
  loading: false,
} as PRSummary

export const PRsListItemArgsVectors = {
  Short,
  Long: {
    title:
      'rather long title that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on',
    author: { ...UserVectors.default },
    created_at: dayjs().subtract(1, 'minute').unix(),
    comments: 0,
    status: 'Open',
    loading: false,
  } as PRSummary,
  LongNoSpaces: {
    title:
      'LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName',
    author: { ...UserVectors.default },
    created_at: dayjs().subtract(3, 'month').subtract(3, 'days').unix(),
    comments: 1,
    status: 'Open',
    loading: false,
  } as PRSummary,
  AuthorLoading: {
    title: 'short title',
    author: { ...UserVectors.loading },
    created_at: dayjs().subtract(3, 'month').subtract(3, 'days').unix(),
    comments: 1,
    status: 'Open',
    loading: false,
  } as PRSummary,
  StatusLoading: {
    ...Short,
    status: undefined,
  } as PRSummary,
  StatusDraft: {
    ...Short,
    status: 'Draft',
  } as PRSummary,
  StatusClosed: {
    ...Short,
    status: 'Closed',
  } as PRSummary,
  StatusMerged: {
    ...Short,
    status: 'Merged',
  } as PRSummary,
}
