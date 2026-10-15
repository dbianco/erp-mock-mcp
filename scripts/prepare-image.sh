#!/usr/bin/env bash
# Usage: scripts/prepare-image.sh <product-id> <downloaded-file>
# Converts any image sips can read (JPEG, WebP, AVIF, ...) to an 800 px wide PNG.
set -euo pipefail
id="$1"
source_file="$2"
out="assets/images/${id}.png"
max_bytes=1000000
mkdir -p assets/images
sips -s format png --resampleWidth 800 "$source_file" --out "$out" > /dev/null
size=$(stat -f%z "$out")
if [ "$size" -gt "$max_bytes" ]; then
  echo "${id}: ${size} bytes is over ${max_bytes}" >&2
  rm -f "$out"
  exit 1
fi
echo "${id}: ${size} bytes"
