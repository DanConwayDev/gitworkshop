# gitworkshop.dev

decentralised alternative to github over nostr

a web client to collaborate on issues and code proposals for git repositories via nostr

available at https://gitworkshop.dev or can be run locally with the same experience as https://gitworkshop.dev doesnt host any data

pairs with sister project see [gitworkshop.dev/ngit](https://gitworkshop.dev/ngit)

[gitworkshop.dev/about](https://gitworkshop.dev/about) for more details

## Developer Guide

### Architecture Overview

The architecture of gitworkshop.dev separates internal and external components and logic, bridging them through a `query-centre`.

#### Internal Components

- **`/lib/components`**: Contains all UI elements, which exclusively retrieve data via the `query-centre`.
- **`/lib/query-centre`**: Returns observables for data from internal sources (InMemoryRelay and LocalDb) and requests updates to these sources through external calls.
- **`/lib/dbs/InMemoryRelay`**: Utilized by the `query-centre` for internal data calls.
- **`/lib/dbs/LocalDb`**: A custom Dexie database that stores information about key data types (pubkeys, repos, issues, PRs), including:
  - Summary information
  - Relay hints and query details
  - Counts of children and relay hints for sub-items
- **`/lib/dbs/LocalRelayDB`**: A persistent local cache relay that the `query-centre` uses to populate the InMemoryRelay before each external query.

#### External Components

- **`/lib/relay/RelaySelection`**: Used by the `query-centre` to identify which relays to query.
- **`/lib/relay/RelayManager`**: Interacts with each relay, adding new events to both local and in-memory relays, and appending data points to the `/lib/processors/Watcher` queue.
- **`/lib/processors`**: The dedicated module for updating the `LocalDb` through data points added to its `Watcher` queue.

## Contributions Welcome!

use ngit to submit proposals!

[gitworkshop.dev/repo/ngit](https://gitworkshop.dev/repo/gitworkshop) to report issues and see proposals
