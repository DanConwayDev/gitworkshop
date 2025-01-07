# gitworkshop.dev

decentralised alternative to github over nostr

a web site (or PWA) to collaborate on issues and code proposals for git repositories via nostr

available at https://gitworkshop.dev or can be run locally with the same experience as https://gitworkshop.dev doesnt host any data

pairs with sister project see [gitworkshop.dev/ngit](https://gitworkshop.dev/ngit)

[gitworkshop.dev/about](https://gitworkshop.dev/about) for more details

## Developer Guide

### Architecture Overview

gitworkshop.dev runs internal and external components and logic in seperate threads, bridging them through a `query-centre`.

#### Internal Components

- **`/lib/components`**: All UI elements, which exclusively retrieve data via the `query-centre`.
- **`/lib/query-centre`**: Returns observables for data from internal sources (InMemoryRelay and LocalDb) and requests updates from external sources (relays, etc) via `QueryCenterExernal`.
- **`/lib/dbs/InMemoryRelay`**: Utilized by the `query-centre` for internal data calls.
- **`/lib/dbs/LocalDb`**: A custom Dexie database that stores information about key data types (pubkeys, repos, issues, PRs), including:
  - Summary information
  - Relay huristics and query details
  - Counts of children and relay hints for sub-items

#### External Components

- **`/lib/query-centre.QueryCentreExternal`**: Runs in a web worker. Fetches data from the below sources when requested by `query-centre`. Passes it to `Processor`. Send selected events back to `query-centre` to be added to `InMemoryDb`
- **`/lib/processors`**: Processes incoming data points in from the below sources, updates `LocalDb` and selects event to added to `InMemoryDb`
- **`/lib/dbs/LocalRelayDB`**: A persistent local cache relay that the `query-centre` uses to populate the InMemoryRelay before each external query.
- **`/lib/relay/RelaySelection`**: Used by `QueryCentreExternal` to identify which relays to query.
- **`/lib/relay/RelayManager`**: Interacts with each relay, and adds events and data points to the `/lib/processors/Processor` queue.

## Contributions Welcome!

use ngit to submit proposals!

[gitworkshop.dev/repo/ngit](https://gitworkshop.dev/repo/gitworkshop) to report issues and see proposals
