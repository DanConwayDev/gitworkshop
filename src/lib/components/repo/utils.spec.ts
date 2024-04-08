import { describe, expect, test } from 'vitest'
import { cloneArrayToReadMeUrls, selectRepoFromCollection } from './utils'
import {
  collection_defaults,
  event_defaults,
  type RepoCollection,
  type RepoEvent,
} from './type'

const repo_event: RepoEvent = {
  ...event_defaults,
  event_id: '123',
  unique_commit: 'abc123',
  identifier: 'abc',
  created_at: 10,
}

describe('getSelectedRepo', () => {
  describe('selected_event_id is default (empty string)', () => {
    test('if no events returns undefined', () => {
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          selected_event_id: 'b',
        } as RepoCollection)
      ).toBeUndefined()
    })
    test('if no event with id returns undefined', () => {
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          selected_event_id: 'b',
          events: [
            {
              ...repo_event,
              event_id: 'a',
              created_at: 1,
              referenced_by: ['d', 'e'],
            },
          ],
        } as RepoCollection)
      ).toBeUndefined()
    })
    test('returns event with selected id', () => {
      const preferable_event = {
        ...repo_event,
        event_id: 'a',
        created_at: 1,
        referenced_by: ['d', 'e'],
      }
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          selected_event_id: preferable_event.event_id,
          events: [
            preferable_event,
            {
              ...repo_event,
              event_id: 'b',
              created_at: 2,
              referenced_by: ['x', 'y', 'z'],
            },
            {
              ...repo_event,
              event_id: 'c',
              created_at: 3,
            },
          ],
        } as RepoCollection)
      ).toEqual(preferable_event)
    })
  })

  describe('selected_event_id is default (empty string)', () => {
    test('if no events returns undefined', () => {
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
        } as RepoCollection)
      ).toBeUndefined()
    })
    test('if referenced_by is undefined (still loading), treat its as no references', () => {
      const preferable_event = {
        ...repo_event,
        event_id: 'c',
        referenced_by: ['d', 'e'],
        created_at: 2,
      }
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          events: [
            {
              ...repo_event,
              event_id: 'a',
              created_at: 1,
            },
            {
              ...repo_event,
              event_id: 'b',
              created_at: 3,
            },
            preferable_event,
          ],
        } as RepoCollection)
      ).toEqual(preferable_event)
    })
    test('if no references to either event return youngest', () => {
      const preferable_event = {
        ...repo_event,
        event_id: 'b',
        created_at: 3,
      }
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          events: [
            {
              ...repo_event,
              event_id: 'a',
              created_at: 1,
            },
            preferable_event,
            {
              ...repo_event,
              event_id: 'c',
              created_at: 2,
            },
          ],
        } as RepoCollection)
      ).toEqual(preferable_event)
    })
    test('returns most referenced event', () => {
      const preferable_event = {
        ...repo_event,
        event_id: 'b',
        created_at: 2,
        referenced_by: ['x', 'y', 'z'],
      }
      expect(
        selectRepoFromCollection({
          ...collection_defaults,
          events: [
            {
              ...repo_event,
              event_id: 'a',
              created_at: 1,
              referenced_by: ['d', 'e'],
            },
            preferable_event,
            {
              ...repo_event,
              event_id: 'c',
              created_at: 3,
            },
          ],
        } as RepoCollection)
      ).toEqual(preferable_event)
    })
  })
})

describe('cloneArrayToReadMeUrls', () => {
  test('for each clone url returns url to /raw/HEAD/README.md and /raw/HEAD/readme.md', () => {
    expect(
      cloneArrayToReadMeUrls([
        'https://gitea.com/orgname/reponame',
        'https://gitlab.com/orgname/reponame',
      ])
    ).toEqual([
      'https://gitea.com/orgname/reponame/raw/HEAD/README.md',
      'https://gitea.com/orgname/reponame/raw/HEAD/readme.md',
      'https://gitlab.com/orgname/reponame/raw/HEAD/README.md',
      'https://gitlab.com/orgname/reponame/raw/HEAD/readme.md',
    ])
  })
  test('for github link use raw.githubusercontent.com/HEAD', () => {
    expect(
      cloneArrayToReadMeUrls(['https://github.com/orgname/reponame'])
    ).toEqual([
      'https://raw.githubusercontent.com/orgname/reponame/HEAD/README.md',
      'https://raw.githubusercontent.com/orgname/reponame/HEAD/readme.md',
    ])
  })
  test('for sr.hr link to /blob/HEAD', () => {
    expect(cloneArrayToReadMeUrls(['https://sr.ht/~orgname/reponame'])).toEqual(
      [
        'https://sr.ht/~orgname/reponame/blob/HEAD/README.md',
        'https://sr.ht/~orgname/reponame/blob/HEAD/readme.md',
      ]
    )
  })
  test('for git.launchpad.net link to /plain', () => {
    expect(
      cloneArrayToReadMeUrls(['https://git.launchpad.net/orgname/reponame'])
    ).toEqual([
      'https://git.launchpad.net/orgname/reponame/plain/README.md',
      'https://git.launchpad.net/orgname/reponame/plain/readme.md',
    ])
  })
  test('for git.savannah.gnu.org link to /plain', () => {
    expect(
      cloneArrayToReadMeUrls(['https://git.savannah.gnu.org/orgname/reponame'])
    ).toEqual([
      'https://git.savannah.gnu.org/orgname/reponame/plain/README.md',
      'https://git.savannah.gnu.org/orgname/reponame/plain/readme.md',
    ])
  })
  describe('transform clone address to url', () => {
    test('strips trailing / from address', () => {
      expect(
        cloneArrayToReadMeUrls(['https://codeberg.org/orgname/reponame/'])
      ).toEqual([
        'https://codeberg.org/orgname/reponame/raw/HEAD/README.md',
        'https://codeberg.org/orgname/reponame/raw/HEAD/readme.md',
      ])
    })
    test('strips .git from address', () => {
      expect(
        cloneArrayToReadMeUrls(['https://codeberg.org/orgname/reponame.git'])
      ).toEqual([
        'https://codeberg.org/orgname/reponame/raw/HEAD/README.md',
        'https://codeberg.org/orgname/reponame/raw/HEAD/readme.md',
      ])
    })
    test('git@codeberg.org:orgname/reponame.git to address', () => {
      expect(
        cloneArrayToReadMeUrls(['git@codeberg.org:orgname/reponame.git'])
      ).toEqual([
        'https://codeberg.org/orgname/reponame/raw/HEAD/README.md',
        'https://codeberg.org/orgname/reponame/raw/HEAD/readme.md',
      ])
    })
    test('ssh://codeberg.org/orgname/reponame to address', () => {
      expect(
        cloneArrayToReadMeUrls(['ssh://codeberg.org/orgname/reponame'])
      ).toEqual([
        'https://codeberg.org/orgname/reponame/raw/HEAD/README.md',
        'https://codeberg.org/orgname/reponame/raw/HEAD/readme.md',
      ])
    })
    test('https://custom.com/deep/deeper/deeper to address', () => {
      expect(
        cloneArrayToReadMeUrls(['https://custom.com/deep/deeper/deeper'])
      ).toEqual([
        'https://custom.com/deep/deeper/deeper/raw/HEAD/README.md',
        'https://custom.com/deep/deeper/deeper/raw/HEAD/readme.md',
      ])
    })
  })
})
