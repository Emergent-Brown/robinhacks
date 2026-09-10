#!/usr/bin/env bash
set -euo pipefail

# The installed @playwright/mcp 0.0.80 package no longer exports a
# playwright-cli binary. Its bundled playwright-core still supplies the CLI.
# Use that exact implementation without downloading a package or touching a
# user's everyday browser profile. Override the path on another workstation.
cli_path="${ROBINHACKS_PLAYWRIGHT_CLI:-}"
if [[ -z "$cli_path" ]]; then
  candidate="$PWD/node_modules/playwright-core/lib/tools/cli-client/cli.js"
  if [[ -f "$candidate" ]]; then
    cli_path="$candidate"
  fi
fi
if [[ -z "$cli_path" ]]; then
  shopt -s nullglob
  for candidate in "$HOME"/.npm/_npx/*/node_modules/playwright-core/lib/tools/cli-client/cli.js; do
    cli_path="$candidate"
    break
  done
fi
if [[ -z "$cli_path" || ! -f "$cli_path" ]]; then
  printf '%s\n' 'No installed Playwright CLI was found. Set ROBINHACKS_PLAYWRIGHT_CLI to playwright-core/lib/tools/cli-client/cli.js.' >&2
  exit 1
fi

# Isolate walkthroughs from other Playwright sessions. A caller can select a
# different session explicitly through the environment, without editing this.
exec node "$cli_path" "-s=${ROBINHACKS_CAPTURE_SESSION:-robinhacks-walkthrough}" "$@"
