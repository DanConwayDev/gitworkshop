#!/usr/bin/env bash

# Regenerate Android launcher and splash raster resources from public/icons.
# Run with: nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh
set -euo pipefail

if command -v magick >/dev/null 2>&1; then
  image_magick=(magick)
elif command -v convert >/dev/null 2>&1; then
  image_magick=(convert)
else
  printf '%s\n' 'ImageMagick is required. Run with: nix shell nixpkgs#imagemagick --command ./scripts/generate-android-branding.sh' >&2
  exit 1
fi

root_dir="$(git rev-parse --show-toplevel)"
source_dir="$root_dir/public/icons"
resource_dir="$root_dir/android/app/src/main/res"
maskable_source="$source_dir/pwa-maskable-512x512.png"
regular_source="$source_dir/icon-512x512.png"
brand_purple="#9333EA"

for source in "$maskable_source" "$regular_source"; do
  if [[ ! -f "$source" ]]; then
    printf 'Missing branding source asset: %s\n' "$source" >&2
    exit 1
  fi
done

# Legacy launcher icon sizes are 48dp at mdpi. The regular icon preserves its
# rounded corners, while the round icon is cropped from the maskable artwork so
# the mark stays inside a circular launcher mask.
declare -A launcher_sizes=(
  [mdpi]=48
  [hdpi]=72
  [xhdpi]=96
  [xxhdpi]=144
  [xxxhdpi]=192
)

# Adaptive foregrounds are 108dp. The purple maskable background is made
# transparent because adaptive-icon supplies it as a separate solid layer. The
# mark itself occupies 80% of the foreground canvas so it remains inside the
# launcher safe zone after Android applies its own icon mask.
declare -A foreground_sizes=(
  [mdpi]=108
  [hdpi]=162
  [xhdpi]=216
  [xxhdpi]=324
  [xxxhdpi]=432
)
adaptive_foreground_scale=0.8

# Pre-Android-12 splash marks retain intrinsic size and are centered by the
# splash layer-list. Portrait gets a slightly larger mark than landscape.
declare -A density_scales=(
  [mdpi]=1
  [hdpi]=1.5
  [xhdpi]=2
  [xxhdpi]=3
  [xxxhdpi]=4
)

rm -f "$resource_dir/drawable/splash.png" \
  "$resource_dir/drawable/ic_launcher_background.xml" \
  "$resource_dir/drawable-v24/ic_launcher_foreground.xml" \
  "$resource_dir/mipmap-anydpi-v26/ic_launcher_round.xml" \
  "$resource_dir"/drawable-*/splash_icon.png \
  "$resource_dir"/drawable-port-*/splash.png \
  "$resource_dir"/drawable-land-*/splash.png

for density in "${!launcher_sizes[@]}"; do
  mkdir -p "$resource_dir/mipmap-$density"
  size="${launcher_sizes[$density]}"
  "${image_magick[@]}" "$regular_source" -resize "${size}x${size}" "$resource_dir/mipmap-$density/ic_launcher.png"
  center=$((size / 2))
  "${image_magick[@]}" "$maskable_source" -resize "${size}x${size}" -alpha off \
    \( -size "${size}x${size}" xc:none -fill white -draw "circle $center,$center $center,0" \) \
    -compose CopyOpacity -composite "$resource_dir/mipmap-$density/ic_launcher_round.png"

  foreground_size="${foreground_sizes[$density]}"
  foreground_mark_size=$(awk "BEGIN { print int($foreground_size * $adaptive_foreground_scale) }")
  "${image_magick[@]}" "$maskable_source" -alpha off -fuzz 2% -transparent "$brand_purple" -resize "${foreground_mark_size}x${foreground_mark_size}" -gravity center -background none -extent "${foreground_size}x${foreground_size}" "$resource_dir/mipmap-$density/ic_launcher_foreground.png"

  scale="${density_scales[$density]}"
  port_size=$(awk "BEGIN { print int(120 * $scale) }")
  land_size=$(awk "BEGIN { print int(96 * $scale) }")
  mkdir -p "$resource_dir/drawable-port-$density" "$resource_dir/drawable-land-$density" "$resource_dir/drawable-$density"
  "${image_magick[@]}" "$regular_source" -resize "${port_size}x${port_size}" "$resource_dir/drawable-$density/splash_mark.png"
  "${image_magick[@]}" "$regular_source" -resize "${port_size}x${port_size}" "$resource_dir/drawable-port-$density/splash_mark.png"
  "${image_magick[@]}" "$regular_source" -resize "${land_size}x${land_size}" "$resource_dir/drawable-land-$density/splash_mark.png"
done
