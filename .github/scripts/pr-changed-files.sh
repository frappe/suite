#!/usr/bin/env bash
set -euo pipefail

base=$1
head=$2

# The PR checkout normally includes the base as a parent of the merge commit.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  git fetch --no-tags --depth=1 origin "$base"
fi

git diff --name-only "$base" "$head"
