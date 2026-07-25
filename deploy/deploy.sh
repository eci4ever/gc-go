#!/usr/bin/env bash
set -Eeuo pipefail

readonly commit_sha="${1:-}"
readonly repo_dir="/home/nmfairus/gc-go"
readonly web_root="/var/www/gc-go"
readonly api_binary="$repo_dir/bin/api"
readonly api_candidate="$repo_dir/bin/api.new"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <40-character-commit-sha>" >&2
  exit 2
fi

cd "$repo_dir"

git fetch --quiet origin main
git checkout --quiet main
git merge --ff-only "$commit_sha"

npm ci
npm run build

mkdir -p "$repo_dir/bin"
(
  cd api
  go mod download
  go build -trimpath -o "$api_candidate" .
)

sudo install -m 0755 "$api_candidate" "$api_binary"
rm "$api_candidate"

sudo install -d -o caddy -g caddy -m 0755 "$web_root"
sudo install -d -o caddy -g caddy -m 0755 "$web_root/assets"
sudo cp -a web/dist/assets/. "$web_root/assets/"
sudo install -o caddy -g caddy -m 0644 web/dist/index.html "$web_root/index.html"

sudo systemctl restart gc-go-api
curl --fail --silent --show-error --retry 10 --retry-delay 1 \
  http://127.0.0.1:3000/api/health >/dev/null

echo "Deployed $commit_sha"
