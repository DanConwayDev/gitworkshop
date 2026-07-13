# Android

Build a debug APK with `pnpm android:build`; it is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. Signed release builds
require a local, ignored `android/signing.properties`; use
`pnpm android:build:release` for the AAB or `pnpm android:build:release:apk`
for the APK.

Android App Links require the release signing certificate fingerprint in
`public/.well-known/assetlinks.json` before deployment.

Android launcher and splash resources are generated from `public/icons/`.
After changing those assets, run:

```sh
nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh
```

Commit the generated Android resources; do not edit them by hand.
