# Contributing to gitworkshop

## Setup

Install [ngit](https://ngit.dev/install).

Clone the repo:

```sh
ngit clone nostr://danconwaydev.com/relay.ngit.dev/gitworkshop
```

## Workflow

1. Create a branch with a `pr/` prefix, e.g. `pr/fix-issue-list-loading`.
2. Make your changes.
3. Before pushing, run the [self-review prompt](#self-review) against your commit(s) with **Claude Sonnet 4.6 or equivalent or better** and address the key concerns.
4. Push via Nostr: `git push -u origin pr/fix-issue-list-loading` or `ngit send`.

No GitHub PRs. Contributions go over Nostr only.

## Self-review

Copy your full `git diff` output and paste it to your AI tool (Claude Sonnet 4.6 or equivalent or better) along with this prompt. Address the key concerns before pushing.

```
Review this diff as if you are a senior maintainer of this codebase who has to
maintain it long-term. For each finding, state the file, line, and issue.

- [ ] Does the diff contain changes that weren't requested? Flag anything out of scope.
- [ ] Is there dead code, commented-out blocks, or debug artifacts left in?
- [ ] Are there placeholder comments like "// In a real app..." or "// TODO: implement"?
- [ ] For every value displayed to a user, can you trace it from source to render without a gap?
- [ ] Are error, loading, and empty states all handled -- and in the right order?
- [ ] Does a mutation reflect in the UI without requiring a manual refresh?
- [ ] Is there a new read/write path that assumes fresh data but could get a stale cache?
- [ ] Are relay queries going through resilientSubscription / resilientRequest, never direct pool calls?
- [ ] Does anything new block the critical render path or fire N+1 network requests?
- [ ] Are Nostr queries efficient (combined kinds, relay-level filtering vs client-side)?
- [ ] Are user inputs used in queries or rendered as content without sanitization?
- [ ] Were existing patterns/conventions in AGENTS.md ignored in favor of something novel?
- [ ] Are secrets, keys, or env-specific values hardcoded?
- [ ] Does the code use the `any` type anywhere?
- [ ] Are new Nostr event kinds documented in NIP.md with links to relevant specs?
- [ ] Are there any new images >100KB or other large binary assets that should be hosted externally?
- [ ] Is there any use of dangerouslySetInnerHTML, eval, innerHTML, or SVG string interpolation?
- [ ] Is any data from a Nostr event (tags, content, pubkey, URLs) used in a security-sensitive context (href, src, query filter, trust decision) without validation?
- [ ] Does new repo-trust-bearing logic filter by the maintainer set from useResolvedRepository, not just by #a / #d tags?

Skip anything a linter or type checker would catch. Focus on logic, data flow, and intent.

Then answer: "If you were the people who have to maintain this codebase and deal
with all long-term issues, what would be your biggest concerns about this
implementation?"
```
