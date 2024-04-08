import { UserVectors, withName } from '../users/vectors'
import type { RepoEventWithMaintainersMetadata, RepoSummary } from './type'

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
const base: RepoEventWithMaintainersMetadata = {
  identifier: '9ee507fc4357d7ee16a5d8901bedcd103f23c17d',
  unique_commit: '9ee507fc4357d7ee16a5d8901bedcd103f23c17d',
  name: 'Short Name',
  description: 'short description',
  clone: ['github.com/example/example'],
  tags: ['svelte', 'nostr', 'code-collaboration', 'git'],
  relays: ['relay.damus.io', 'relay.snort.social', 'relayable.org'],
  maintainers: [
    withName(UserVectors.default, 'carole'),
    withName(UserVectors.default, 'bob'),
    withName(UserVectors.default, 'steve'),
  ],
  loading: false,
  event_id: '',
  naddr: '',
  web: ['https://gitworkshop.dev/repo/example', 'https://example.com'],
  referenced_by: [],
  created_at: 0,
}

export const RepoDetailsArgsVectors = {
  Short: { ...base } as RepoEventWithMaintainersMetadata,
  Long: {
    ...base,
    name: 'Long Name that goes on and on and on and on and on and on and on and on and on',
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie.',
  } as RepoEventWithMaintainersMetadata,
  LongNoSpaces: {
    ...base,
    name: 'LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName',
    description:
      'LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum',
  } as RepoEventWithMaintainersMetadata,
  NoNameOrDescription: {
    ...base,
    name: '',
    description: '',
  } as RepoEventWithMaintainersMetadata,
  NoDescription: {
    ...base,
    description: '',
  } as RepoEventWithMaintainersMetadata,
  NoTags: { ...base, tags: [] } as RepoEventWithMaintainersMetadata,
  NoGitServer: { ...base, clone: [''] } as RepoEventWithMaintainersMetadata,
  NoWeb: { ...base, web: [] } as RepoEventWithMaintainersMetadata,
  MaintainersOneProfileNotLoaded: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.loading },
      { ...base.maintainers[2] },
    ],
  } as RepoEventWithMaintainersMetadata,
  MaintainersOneProfileDisplayNameWithoutName: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_only },
      { ...base.maintainers[2] },
    ],
  } as RepoEventWithMaintainersMetadata,
  MaintainersOneProfileNameAndDisplayNamePresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_and_name },
      { ...base.maintainers[2] },
    ],
  } as RepoEventWithMaintainersMetadata,
  MaintainersOneProfileNoNameOrDisplayNameBeingPresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.no_profile },
      { ...base.maintainers[2] },
    ],
  } as RepoEventWithMaintainersMetadata,
  NoMaintainers: {
    ...base,
    maintainers: [],
  } as RepoEventWithMaintainersMetadata,
  NoRelays: { ...base, relays: [] } as RepoEventWithMaintainersMetadata,
  NoMaintainersOrRelays: {
    ...base,
    maintainers: [],
    relays: [],
  } as RepoEventWithMaintainersMetadata,
}
