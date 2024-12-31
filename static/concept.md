# Concept ngit quick start guide

This is a concept which the developer would like to work towards. a lot of the features / commands are not available yet.

## How it Works

nostr is a decentralised communications protocol with:

- permissionless account creation - created via a public/private key pair
- verifiable signed messages
- messages transported via relays rather than P2P

Code Collaboration via Nostr

- proposals (PRs), issues and related discussion, status, etc. are sent / recieved via nostr.
- repository state stored in nostr.
- git server(s) still required for data storage and transport but they act as dumb relays (apart from use for CI/CD).
  maintainers can change git servers via nostr and users will automatically start using the new git server.

[insert diagram which makes git severs appear like just another nostr relay - potentially something like this:]

```
             ┌──────────┐
             │  Author  │
             └──/─┬─\───┘
        ,------'  │  '--------.-------.
┌──────▼─┐   ┌────▼───┐   ┌───▼───┐  ┌─▼─────┐  ┌───────┐
│  Git   │   │  Git   │   │ Relay │  │ Relay │  │ Relay │
│ Server │   │ Server │   │       │  │       │  │       │
└────────┘   └────\───┘   └───┬───┘  └──/────┘  └─/─────┘
                   \----*-.   │   ,----/---------/
                         ┌─▼──▼──▼─┐
                         │  User   │
                         └─────────┘
```

\* git servers are used as dumb relays with content verified via nostr events.

## Contributor's Quick Start Guide

1. install ngit

- download [linux windows mac] (vX.X) add binaries $PATH
- OR if you have cargo use `cargo install ngit`

2. find repository
   - using `ngit search` eg `ngit search amethyst`
     ```
       name        maintainer(s) starred by
     > amethyst    👥Vitor       Gigi, fiatjaf, franzap, +5 👥
       amethyst    impersonator
     ```
   - OR using gitworkshop.dev
     - browse https://gitworkshop.dev/repos for the repository
     - explore proposals and issues
     - copy the naddr (or press the green clone button to copy the clone command)
3. clone repository
   `git clone nostr://naddr123...`
4. view open proposals
   - `ngit list` - select proposal from titles to checkout branch or apply to current branch tip
   - OR review branches starting with 'origin/prs/\*' with your favourate git tool
     - eg. for git cli use `git branch -r --list origin/prs/` to list and `git switch prs/add-offline-mode[e9ra8281]` to check out
     - view and contribute to the proposal discussion on gitworkshop.dev
5. submit proposal
   - `ngit send` to send with options
   - OR `git push -u` on a branch without an exisitng upstream will submit it as a proposal without commentary if you are not a maintainer
6. update proposal
   - `git push` from your proposal branch
7. download releases using `ngit releases amethyst`

   ```
     name        maintainer(s) starred by
   > amethyst    👥Vitor       Gigi, fiatjaf, franzap, +5 👥
     amethyst    impersonator
   ```

   ```
   amethyst by 👥Vitor
   --------------------------------------
     release                      # files
   > v0.87.7: Revert Save button  14
     v0.87.6                      14
     v0.87.5                      14
   ...
   ```

   ```
   amethyst by Vitor
   --------------------------------------
   download v0.87.7: Revert Save button (14 files)
     all (14 files)
   > amethyst-fdroid-arm64-v8a-v0.087.7.apk
     amethyst-fdroid-armeabi-v8a-v0.087.7.apk
     amethyst-fdroid-universal-v8a-v0.087.7.apk
   ...
   ```

   ```
   downloaded to ./amethyst-fdroid-arm64-v8a-v0.087.7.apk
   checksum verified
   ```

## Maintainer's Quick Start Guide

0. for completely fresh git repositories

   1. create a new local git repository
      - `git init`
      - add an initial commit with a `README.md`
   2. setup a git server with PRs and Issues disabled
      - github guide, codeberg guide, self host (gitea/forgejo guide)

1. install ngit
   - download [linux windows mac] (vX.X) add binaries $PATH
   - OR if you have cargo use `cargo install ngit`
2. initalize on nostr
   - run `ngit init` from git repository, which will:
   1. announce with setting such as:
      - inbox relays - where contributors should send proposals / issues
      - clone - git server(s) to fetch data from
      - settings can be updated by running `ngit init` again
   2. publish state
      - from branch / tag refs on first git server in announcement
   3. add nostr as git remote
      - `git push` will now update state on nostr and push data to all git servers listed in annonucment event
3. manage proposals
   - view and apply open proposals (see contributor guide)
   - use gitworkshop.dev to comment on or close it
   - if you applied a proposal to master or used `git merge`, the proposal status will be updated when you push those commits
4. issue releases
   [TODO]
5. update comms - direct contributors to use nostr. eg. on readme and website.
