# Android branding assets

Android launcher and splash resources are generated from the versioned web
assets in `public/icons/`:

- `pwa-maskable-512x512.png` supplies the round launcher raster and adaptive
  foreground. Its safe zone prevents Android launcher masks from clipping the
  GitWorkshop mark.
- `icon-512x512.png` supplies the normal launcher raster and splash mark. It
  is a transparent-corner, rounded GitWorkshop icon which matches the
  first-paint web splash.
- `icon-192x192.png`, `pwa-maskable-192x192.png`, and `icon.svg` remain the
  corresponding web/PWA source assets; the 512px assets avoid upscaling while
  generating Android densities.

## Regenerating resources

After replacing the source artwork, regenerate all Android raster resources:

```sh
nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh
```

The script writes the five standard Android density buckets (`mdpi` through
`xxxhdpi`) for normal, round, and adaptive launcher icons. Android 8+ uses the
adaptive primary icon, whose foreground is scaled into the system safe zone so
the launcher mask leaves visible breathing room around the mark. `roundIcon`
uses the round raster for App Info and other system surfaces. It also writes
portrait and landscape density-qualified splash marks. Android 12+ uses the
vector `drawable/splash_icon.xml`, which stays crisp at the system-selected
size and scales the white mark into Android's circular splash-icon safe zone.
The XML resources keep the splash background separate as `#16171e`; no device
status or navigation bar pixels are baked into the images.

`values/styles.xml` uses the same colour and AndroidX SplashScreen attributes
for Android 12+, while `drawable/splash.xml` centres the density-qualified
mark on older Android versions. Review and commit the generated PNGs alongside
the source-art update; do not hand-edit them.
