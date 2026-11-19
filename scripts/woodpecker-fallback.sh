#!/usr/bin/env bash
# Manually dispatch the GitHub Actions ci.yml fallback for a branch.
# Use when Woodpecker is offline or a gate is stuck.
# Usage: scripts/woodpecker-fallback.sh [branch]   (defaults to current branch)
set -euo pipefail
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Dispatching ci.yml for branch: $BRANCH"
gh workflow run ci.yml --ref "$BRANCH" || \
  gh api -X POST "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions/workflows/ci.yml/dispatches" -f ref="$BRANCH"
echo "Dispatched."