#!/usr/bin/env bash
set -Eeuo pipefail

readonly commit_sha="${1:-}"
readonly registry_user="${2:-}"
readonly repo_dir="/home/nmfairus/gc-go"
readonly compose_file="$repo_dir/compose.production.yaml"
readonly env_file="$repo_dir/.env"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy.sh <40-character-commit-sha> <registry-user>" >&2
  exit 2
fi

if [[ -z "$registry_user" ]]; then
  echo "Registry user is required" >&2
  exit 2
fi

if [[ ! -f "$env_file" ]]; then
  echo "$env_file is missing" >&2
  exit 1
fi

registry_token="$(</dev/stdin)"
if [[ -z "$registry_token" ]]; then
  echo "Registry token is required on stdin" >&2
  exit 1
fi

cd "$repo_dir"
git fetch --quiet origin main
git cat-file -e "${commit_sha}^{commit}"
git checkout --quiet --detach "$commit_sha"

printf '%s' "$registry_token" |
  sudo docker login ghcr.io --username "$registry_user" --password-stdin >/dev/null
unset registry_token
trap 'sudo docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

export IMAGE_TAG="$commit_sha"
readonly compose=(sudo docker compose --env-file "$env_file" -f "$compose_file")

"${compose[@]}" pull
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait api web

curl --fail --silent --show-error --retry 12 --retry-delay 5 \
  --noproxy "*" \
  --resolve vms.nimfi.dev:443:127.0.0.1 \
  https://vms.nimfi.dev/api/health >/dev/null

sudo docker image prune --force >/dev/null
echo "Deployed $commit_sha to https://vms.nimfi.dev"
