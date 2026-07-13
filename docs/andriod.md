# Android

Build a debug APK with `pnpm android:build`; it is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. Signed release builds
require a local, ignored `android/signing.properties`; use
`pnpm android:build:release` for the AAB or `pnpm android:build:release:apk`
for the APK.

## Releases

Android releases have their own version cycle, independent from more frequent
web deployments. Before building an Android release, update
`android/version.properties`. It is the source of the Android `versionName`;
Gradle derives a monotonically increasing `versionCode` as
`major * 1_000_000 + minor * 1_000 + patch`.

Push an `android-v<version>` tag matching `VERSION_NAME` (for example,
`android-v3.0.0`) to run the signed AAB workflow. The Android bundle embeds
that version in the web footer alongside its date and commit hash. Ordinary web
builds instead identify themselves as `Web` plus their date and commit hash.

Android App Links require the release signing certificate fingerprint in
`public/.well-known/assetlinks.json` before deployment.

Android launcher and splash resources are generated from `public/icons/`.
After changing those assets, run:

```sh
nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh
```

Commit the generated Android resources; do not edit them by hand.
