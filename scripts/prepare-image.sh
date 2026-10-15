#!/usr/bin/env bash
# Usage: scripts/prepare-image.sh <product-id> <downloaded-file>
set -euo pipefail
id="$1"
source_file="$2"
out="assets/images/${id}.jpg"
mkdir -p assets/images
for quality in 80 70 60 50 40; do
  sips -s format jpeg -s formatOptions "$quality" --resampleWidth 800 "$source_file" --out "$out" > /dev/null
  size=$(stat -f%z "$out")
  if [ "$size" -le 200000 ]; then
    echo "${id}: ${size} bytes (quality ${quality})"
    exit 0
  fi
done
echo "${id}: could not get under 200000 bytes" >&2
exit 1
