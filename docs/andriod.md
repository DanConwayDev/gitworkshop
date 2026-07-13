# Android

Build a debug APK with `pnpm android:build`; it is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. Signed release builds
require a local, ignored `android/signing.properties`; use
`pnpm android:build:release` for both the AAB and APK, or
`pnpm android:build:release:apk` for only the APK.

## Releases

All platform releases share an application version. Before building a release,
update the root `version.properties`; `APP_VERSION` is the source of the Android
`versionName`. Gradle derives a monotonically increasing `versionCode` as
`major * 100_000_000 + minor * 100_000 + patch * 100 + stage`. Final releases
use stage 99; release candidates use `-rc.1` through `-rc.98`, so an RC can be
installed and then upgraded to its final release.

Push a `v<version>` tag matching `APP_VERSION` (for example, `v3.0.0`) to run
the signed AAB and APK workflow. It uploads both
artifacts but deliberately does not publish to Zapstore yet; validate signed APK
builds before enabling that publication. The Android bundle embeds that version
in the footer alongside its date and commit hash. Ordinary web builds instead
identify themselves as `Web` plus their date and commit hash.

Android App Links require the release signing certificate fingerprint in
`public/.well-known/assetlinks.json` before deployment.

Android launcher and splash resources are generated from `public/icons/`.
After changing those assets, run:

```sh
nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh
```

Commit the generated Android resources; do not edit them by hand.
