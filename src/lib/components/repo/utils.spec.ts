import { describe, expect, test } from 'vitest'
import { cloneArrayToReadMeUrls } from './utils'

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
    test('strips port eg ssh://git@git.v0l.io:2222/Kieran/snort.git to address', () => {
      expect(
        cloneArrayToReadMeUrls(['ssh://git@git.v0l.io:2222/Kieran/snort.git'])
      ).toEqual([
        'https://git.v0l.io/Kieran/snort/raw/HEAD/README.md',
        'https://git.v0l.io/Kieran/snort/raw/HEAD/readme.md',
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
