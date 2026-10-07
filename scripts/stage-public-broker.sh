#!/usr/bin/env bash
set -euo pipefail

# Stage only committed source and the generated sandbox program. The separate
# rootless Broker user can read this directory without reading zima's home.
if [[ -n $(git status --porcelain) ]]; then
  echo 'Commit source changes before creating the Broker build context.' >&2
  exit 1
fi
pnpm exec tsc -p deployment/tsconfig.sandbox.json
revision=$(git rev-parse --short=12 HEAD)
stage="/tmp/mypi-public-build-$revision"
if [[ -e $stage ]]; then
  echo "Build context already exists: $stage" >&2
  exit 1
fi
install -d -m 755 "$stage"
git archive HEAD | tar -x -C "$stage"
cp -a dist-sandbox "$stage/dist-sandbox"
chmod -R a+rX "$stage"
echo "Staged public Broker build context: $stage"
