import { UserVectors, withName } from '../users/vectors'
import type { RepoEvent, RepoSummary } from './type'

export const RepoSummaryCardArgsVectors = {
  Short: {
    name: 'Short Name',
    description: 'short description',
    maintainers: [withName(UserVectors.default, 'Will')],
  } as RepoSummary,
  Long: {
    name: 'Long Name that goes on and on and on and on and on and on and on and on and on',
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.',
    maintainers: [withName(UserVectors.default, 'Rather Long Display Name')],
  } as RepoSummary,
  LongNoSpaces: {
    name: 'LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName',
    description:
      'LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum>',
    maintainers: [
      {
        ...UserVectors.default,
      },
    ],
  } as RepoSummary,
  MulipleMaintainers: {
    name: 'Short Name',
    description: 'short description',
    maintainers: [
      withName(UserVectors.default, 'Will'),
      withName(UserVectors.default, 'DanConwayDev'),
      withName(UserVectors.default, 'sectore'),
    ],
  } as RepoSummary,
}
const base: RepoEvent = {
  identifier: '9ee507fc4357d7ee16a5d8901bedcd103f23c17d',
  unique_commit: '9ee507fc4357d7ee16a5d8901bedcd103f23c17d',
  name: 'Short Name',
  description: 'short description',
  clone: 'github.com/example/example',
  tags: ['svelte', 'nostr', 'code-collaboration', 'git'],
  relays: ['relay.damus.io', 'relay.snort.social', 'relayable.org'],
  maintainers: [
    withName(UserVectors.default, 'carole'),
    withName(UserVectors.default, 'bob'),
    withName(UserVectors.default, 'steve'),
  ],
  loading: false,
  event_id: '',
  web: ['https://gitworkshop.dev/repo/example', 'https://example.com'],
  referenced_by: [],
  created_at: 0,
}

export const RepoDetailsArgsVectors = {
  Short: { ...base } as RepoEvent,
  Long: {
    ...base,
    name: 'Long Name that goes on and on and on and on and on and on and on and on and on',
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie.',
  } as RepoEvent,
  LongNoSpaces: {
    ...base,
    name: 'LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName',
    description:
      'LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum',
  } as RepoEvent,
  NoNameOrDescription: { ...base, name: '', description: '' } as RepoEvent,
  NoDescription: { ...base, description: '' } as RepoEvent,
  NoTags: { ...base, tags: [] } as RepoEvent,
  NoGitServer: { ...base, clone: '' } as RepoEvent,
  NoWeb: { ...base, web: [] } as RepoEvent,
  MaintainersOneProfileNotLoaded: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.loading },
      { ...base.maintainers[2] },
    ],
  } as RepoEvent,
  MaintainersOneProfileDisplayNameWithoutName: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_only },
      { ...base.maintainers[2] },
    ],
  } as RepoEvent,
  MaintainersOneProfileNameAndDisplayNamePresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_and_name },
      { ...base.maintainers[2] },
    ],
  } as RepoEvent,
  MaintainersOneProfileNoNameOrDisplayNameBeingPresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.no_profile },
      { ...base.maintainers[2] },
    ],
  } as RepoEvent,
  NoMaintainers: { ...base, maintainers: [] } as RepoEvent,
  NoRelays: { ...base, relays: [] } as RepoEvent,
  NoMaintainersOrRelays: { ...base, maintainers: [], relays: [] } as RepoEvent,
}
