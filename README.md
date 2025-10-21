# gitworkshop.dev

decentralised alternative to github over nostr

a web site (or PWA) to collaborate on issues and code PRs for git repositories via nostr

available at https://gitworkshop.dev or can be run locally with the same experience as https://gitworkshop.dev doesnt host any data

pairs with sister project see [gitworkshop.dev/ngit](https://gitworkshop.dev/ngit)

[gitworkshop.dev/about](https://gitworkshop.dev/about) for more details

## Progressive Web App (PWA)

GitWorkshop.dev is a fully functional Progressive Web App that can be installed on desktop and mobile devices:

- **📱 Installable**: Add to home screen on iOS, Android, and desktop
- **⚡ Fast**: Instant loading with cached assets
- **📴 Offline**: Browse cached repositories without internet
- **🔄 Auto-update**: Automatic updates with user notification

### Installation

- **Desktop**: Click the install icon in the address bar
- **iOS**: Share → Add to Home Screen
- **Android**: Menu → Install app

### Testing PWA Features

**Development mode** (`pnpm run dev`): PWA disabled to avoid errors

**Preview mode** (`pnpm run build && pnpm run preview`): Full PWA testing
- Test offline: DevTools → Network → Check "Offline" → Refresh
- Service worker registers and caches assets
- Offline navigation works

**Production**: Full PWA functionality on Netlify

## Developer Guide

## System Architecture Overview

The architecture follows a clear separation between internal and external components, with the `QueryCentre` serving as the central communication hub. Internal components run in the main thread, while external components operate in separate threads (Web Workers) to prevent UI blocking and ensure optimal performance.

```mermaid
graph TB
    subgraph "Internal Components (Main Thread)"
        UI[/lib/components<br/>UI Components]
        QC[/lib/query-centre<br/>QueryCentre]
        IMR[/lib/dbs/InMemoryRelay<br/>In-Memory Cache]
        LD[/lib/dbs/LocalDb<br/>Local Database]
        GM[/lib/dbs/git-manager<br/>Git Manager]
    end

    subgraph "External Components (Web Worker)"
        QCE[/lib/query-centre<br/>QueryCentreExternal]
        PROC[/lib/processors<br/>Processor & Specialized Processors]
        LRD[/lib/dbs/LocalRelayDb<br/>Local Relay Cache]
        RS[/lib/relay/RelaySelection<br/>Relay Selection]
        RM[/lib/relay/RelayManager<br/>Per-Relay Manager]
    end

    subgraph "External Data Sources"
        RELAYS[Nostr Relays]
        GIT[Git Repositories]
    end

    UI --> QC
    QC --> IMR
    QC --> LD
    QC --> GM

    QC --> QCE
    QCE --> RS
    RS --> RM
    RM --> RELAYS
    QCE --> PROC
    PROC --> LRD
    PROC --> LD
    GM --> GIT

    IMR -.->|Data Flow| QC
    LRD -.->|Cache Population| IMR
```

## Internal Components

The internal components run in the main thread and are responsible for user interface rendering and local data management:

### `/lib/components`

All UI elements, which exclusively retrieve data via the `query-centre`. These components are reactive and automatically update when underlying data changes.

### `/lib/query-centre`

The central communication hub that:

- Returns observables for data from internal sources (InMemoryRelay and LocalDb)
- Requests updates from external sources (relays, etc) via `QueryCentreExternal`
- Manages data synchronization between internal and external components
- Handles message passing and event-driven communication

### `/lib/dbs/InMemoryRelay`

A high-performance in-memory cache utilized by the `query-centre` for fast internal data calls. This provides immediate feedback to UI components while external queries are in progress.

### `/lib/dbs/LocalDb`

A custom Dexie database that stores comprehensive information about key data types:

- Pubkeys, repositories, issues, and PRs with full metadata
- Summary information and relationships between entities
- Relay heuristics and query optimization details
- Counts of children and relay hints for efficient sub-item retrieval
- Offline capability and data persistence

### `/lib/dbs/git-manager`

Browser-based Git operations using isomorphic-git, enabling:

- Repository cloning and management
- Code diff generation and PR handling
- Local file operations and version control

## External Components

External components operate in separate threads to prevent UI blocking and handle resource-intensive operations:

### `/lib/query-centre.QueryCentreExternal`

Runs in a web worker and serves as the external communication bridge:

- Fetches data from external sources when requested by the main `query-centre`
- Passes retrieved data to the `Processor` for handling
- Sends selected events back to `query-centre` to be added to `InMemoryRelay`
- Manages external API calls and relay communication

### `/lib/processors`

A sophisticated processing system with specialized processors:

- **`Processor`**: Base processor that coordinates data handling
- **`Issue`**: Handles issue-related events and updates
- **`Pr`**: Manages pull request data and workflows
- **`Repo`**: Processes repository information and metadata
- **`Pubkey`**: Handles user pubkey management and profiles
- **`Outbox`**: Manages outgoing events and message queuing
- Each processor updates `LocalDb` and selects events to be added to `InMemoryRelay`

### `/lib/dbs/LocalRelayDb`

A persistent local cache relay that the `query-centre` uses to populate the InMemoryRelay before each external query, reducing redundant network calls.

### `/lib/relay/RelaySelection`

Intelligent relay selection algorithm used by `QueryCentreExternal` to identify the most appropriate relays for specific queries based on:

- Historical performance data
- Content specialization
- Network proximity and reliability
- User preferences and relay configurations

### `/lib/relay/RelayManager`

Individual relay managers that:

- Handle communication with specific Nostr relays
- Manage connection pooling and error handling
- Add events and data points to the processor queue
- Implement relay-specific protocols and optimizations

## Message Passing and Event-Driven Architecture

The system operates through sophisticated message passing and event-driven patterns:

1. **Data Flow**: UI components request data through `QueryCentre`, which either serves from local caches or delegates to `QueryCentreExternal`
2. **Event Processing**: External data flows through specialized processors that transform and enrich the data
3. **State Synchronization**: Processed data updates both `LocalDb` (for persistence) and `InMemoryRelay` (for UI responsiveness)
4. **Bidirectional Communication**: Components communicate through observable streams and event emitters, ensuring real-time updates

## Thread Separation Benefits

This multi-threaded architecture provides several key advantages:

- **UI Responsiveness**: Main thread remains unblocked by external network operations
- **Performance**: Parallel processing of data operations and relay communications
- **Scalability**: Each relay manager operates independently, handling multiple connections
- **Reliability**: Isolated error handling prevents system-wide failures
- **Resource Management**: CPU-intensive operations (like Git processing) don't impact UI performance

## Contributions Welcome!

use ngit to submit PRs!

[gitworkshop.dev/repo/ngit](https://gitworkshop.dev/repo/gitworkshop) to report issues and see PRs
