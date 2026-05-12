# GitWorkshop

The most mature web client for [NIP-34](https://nips.nostr.com/34) git collaboration over Nostr — issues, pull requests, code review, and a bandwidth-efficient git explorer, all without a central platform.

## Protocols, not platforms

GitWorkshop is built on [GRASP](https://gitworkshop.dev/spec/grasp), a thin layer over the git and Nostr protocols that brings decentralisation to the git server and enables Nostr-signed repo state, multi-server redundancy, and open permissionless collaboration. No silo, no lock-in.

Pairs nicely with [ngit](https://ngit.dev) and other [NIP-34](https://nips.nostr.com/34) tools.

## Git explorer

The built-in git explorer fetches only what it needs — commit graphs, trees, and individual blobs on demand — racing across all announced GRASP mirrors and caching objects locally. No full clone required.

## Live

[gitworkshop.dev](https://gitworkshop.dev)

## Dev

```sh
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). No GitHub PRs — contributions go over Nostr only.
