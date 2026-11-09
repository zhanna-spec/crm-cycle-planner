#!/usr/bin/env bash
# Builds index.html (GitHub Pages) from src/app.html
set -e
cd "$(dirname "$0")"
src=src/app.html
split=$(grep -n '^<div class="wrap">' "$src" | cut -d: -f1)
{
  echo '<!doctype html>'
  echo '<html lang="en">'
  echo '<head>'
  echo '<meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  head -n $((split-1)) "$src"
  echo '<style>body{margin:0}[hidden]{display:none!important}</style>'
  echo '</head>'
  echo '<body>'
  tail -n +$split "$src"
  echo '</body>'
  echo '</html>'
} > index.html
echo "built index.html"
