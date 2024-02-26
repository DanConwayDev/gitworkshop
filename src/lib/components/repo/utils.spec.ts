import { describe, expect, test } from 'vitest'
import { selectRepoFromCollection } from './utils'
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
