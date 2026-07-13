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

Use Node 24.x, matching CI. Neither Nix nor pnpm is required for day-to-day
development; they are conveniences for reproducible environments and faster
installs.

pnpm is the preferred package manager when available:

```sh
pnpm install
pnpm dev
```

If pnpm is not available, npm is also supported:

```sh
npm ci
npm run dev
```

Nix users can enter the dev shell first to get the pinned Node/pnpm toolchain:

```sh
nix develop
pnpm install
pnpm dev
```

When changing dependencies, use pnpm so `pnpm-lock.yaml` stays authoritative,
then refresh the npm lockfile for npm users:

```sh
pnpm add <package>
npm install --package-lock-only
```

## Android

GitWorkshop has a Capacitor-backed Android APK build. `pnpm android:build`
creates a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Android Back navigation

On native Android only, the hardware Back button follows the WebView's history
one entry at a time. At `/` with no prior WebView entry, GitWorkshop exits. A
cold-started deep link may be the first WebView entry even though it is not the
root route; in that case, Back replaces the deep link with `/` instead of
exiting. A subsequent Back at that root exits. Open web dialogs receive Escape
first, so Back closes or preserves them according to their existing dialog
behavior rather than navigating away.

For signed releases, create and store the upload key securely **outside this
repository** (for example, in encrypted offline or organisation-managed secret
storage). Losing the signing key prevents publishing future updates to the same
Android application ID. Create `android/signing.properties` locally (it is
ignored) with:

```properties
storeFile=/secure/path/to/gitworkshop-upload.jks
storePassword=...
keyAlias=...
keyPassword=...
```

`pnpm android:build:release` creates the Play-ready signed bundle at
`android/app/build/outputs/bundle/release/app-release.aab`; `pnpm
android:build:release:apk` creates the signed APK at
`android/app/build/outputs/apk/release/app-release.apk`. Both commands fail
before building if the local signing configuration is missing or incomplete and
never fall back to the debug key.

### Android App Links

The Android manifest verifies HTTPS App Links for both `gitworkshop.dev` and
`www.gitworkshop.dev`, including every React Router path. Before a release, the
placeholder in `public/.well-known/assetlinks.json` **must** be replaced with
the SHA-256 certificate fingerprint of the permanent release signing key (the
key configured in `android/signing.properties`):

```sh
keytool -list -v -keystore /secure/path/to/gitworkshop-upload.jks -alias <keyAlias>
```

Copy the `SHA256:` value exactly (including colon separators) into the sole
`sha256_cert_fingerprints` entry, then deploy the generated file at
`https://gitworkshop.dev/.well-known/assetlinks.json` and
`https://www.gitworkshop.dev/.well-known/assetlinks.json` with no redirects.
If a store re-signs the distributed app, use that store's app-signing
certificate fingerprint instead of the upload-key fingerprint.

Build the debug APK reproducibly on NixOS with:

```sh
nix develop --command pnpm android:build
```

With a device connected and the APK installed, verify association and route
handling with:

```sh
adb shell pm get-app-links dev.gitworkshop
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://gitworkshop.dev/search?q=app-link#results'
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://www.gitworkshop.dev/ngit?source=adb#install'
```

The package should report verified hosts after Android has fetched the deployed
asset links file. The activity should open directly to the supplied path while
retaining its query and fragment.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). No GitHub PRs — contributions go over Nostr only.
