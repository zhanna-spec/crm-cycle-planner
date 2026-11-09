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

# Package the site scanner extension so it can be downloaded from GitHub Pages.
if command -v zip >/dev/null 2>&1; then
  rm -f scanner-extension.zip
  (cd extension && zip -qr ../scanner-extension.zip . -x '*.DS_Store' 'README.md')
  echo "built scanner-extension.zip"
fi
