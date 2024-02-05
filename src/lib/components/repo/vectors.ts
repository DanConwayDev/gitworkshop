import { UserVectors, withName } from '../users/vectors'
import type { Repo, RepoSummary } from './type'

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
const base: Repo = {
  repo_id: '9ee507fc4357d7ee16a5d8901bedcd103f23c17d',
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
}

export const RepoDetailsArgsVectors = {
  Short: { ...base } as Repo,
  Long: {
    ...base,
    name: 'Long Name that goes on and on and on and on and on and on and on and on and on',
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie.',
  } as Repo,
  LongNoSpaces: {
    ...base,
    name: 'LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName',
    description:
      'LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum',
  } as Repo,
  NoNameOrDescription: { ...base, name: '', description: '' } as Repo,
  NoDescription: { ...base, description: '' } as Repo,
  NoTags: { ...base, tags: [] } as Repo,
  NoGitServer: { ...base, clone: '' } as Repo,
  MaintainersOneProfileNotLoaded: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.loading },
      { ...base.maintainers[2] },
    ],
  } as Repo,
  MaintainersOneProfileDisplayNameWithoutName: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_only },
      { ...base.maintainers[2] },
    ],
  } as Repo,
  MaintainersOneProfileNameAndDisplayNamePresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.display_name_and_name },
      { ...base.maintainers[2] },
    ],
  } as Repo,
  MaintainersOneProfileNoNameOrDisplayNameBeingPresent: {
    ...base,
    maintainers: [
      { ...base.maintainers[0] },
      { ...UserVectors.no_profile },
      { ...base.maintainers[2] },
    ],
  } as Repo,
  NoMaintainers: { ...base, maintainers: [] } as Repo,
  NoRelays: { ...base, relays: [] } as Repo,
  NoMaintainersOrRelays: { ...base, maintainers: [], relays: [] } as Repo,
}
