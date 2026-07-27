#!/usr/bin/env bash
set -Eeuo pipefail

readonly go_version="1.26.0"
readonly node_version="24.18.0"
readonly app_user="nmfairus"
readonly repo_dir="/home/$app_user/gc-go"
readonly web_root="/var/www/gc-go"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/provision-debian.sh" >&2
  exit 1
fi

if [[ ! -f /etc/debian_version ]]; then
  echo "This provisioning script supports Debian-based systems only." >&2
  exit 1
fi

if ! id "$app_user" >/dev/null 2>&1; then
  echo "Required deployment user '$app_user' does not exist." >&2
  exit 1
fi

case "$(dpkg --print-architecture)" in
  amd64)
    go_arch="amd64"
    node_arch="x64"
    ;;
  arm64)
    go_arch="arm64"
    node_arch="arm64"
    ;;
  *)
    echo "Supported architectures are amd64 and arm64." >&2
    exit 1
    ;;
esac

readonly temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  debian-archive-keyring \
  debian-keyring \
  git \
  gnupg \
  sudo \
  tar \
  xz-utils

go_archive="go${go_version}.linux-${go_arch}.tar.gz"
curl --fail --location --silent --show-error \
  "https://go.dev/dl/${go_archive}" \
  --output "$temp_dir/$go_archive"
curl --fail --location --silent --show-error \
  "https://go.dev/dl/${go_archive}.sha256" \
  --output "$temp_dir/$go_archive.sha256"
(
  cd "$temp_dir"
  printf '%s  %s\n' "$(tr -d '[:space:]' < "$go_archive.sha256")" "$go_archive" |
    sha256sum --check -
)
rm -rf /usr/local/go
tar -C /usr/local -xzf "$temp_dir/$go_archive"
ln -sfn /usr/local/go/bin/go /usr/local/bin/go
ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt

node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
curl --fail --location --silent --show-error \
  "https://nodejs.org/dist/v${node_version}/${node_archive}" \
  --output "$temp_dir/$node_archive"
curl --fail --location --silent --show-error \
  "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" \
  --output "$temp_dir/SHASUMS256.txt"
(
  cd "$temp_dir"
  grep " ${node_archive}\$" SHASUMS256.txt | sha256sum --check -
)
rm -rf "/usr/local/lib/nodejs/node-v${node_version}-linux-${node_arch}"
install -d -m 0755 /usr/local/lib/nodejs
tar -C /usr/local/lib/nodejs -xJf "$temp_dir/$node_archive"
for executable in node npm npx corepack; do
  ln -sfn \
    "/usr/local/lib/nodejs/node-v${node_version}-linux-${node_arch}/bin/$executable" \
    "/usr/local/bin/$executable"
done

curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" |
  gpg --dearmor --yes \
    --output /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
  --output /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 \
  /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  /etc/apt/sources.list.d/caddy-stable.list
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y caddy

if [[ ! -d "$repo_dir/.git" ]]; then
  echo "Repository must be cloned to $repo_dir before provisioning services." >&2
  exit 1
fi

install -d -o "$app_user" -g "$app_user" -m 0755 "$repo_dir/bin"
install -d -o "$app_user" -g caddy -m 0755 "$web_root"
install -o root -g root -m 0644 \
  "$repo_dir/deploy/gc-go-api.service" \
  /etc/systemd/system/gc-go-api.service
install -o root -g root -m 0644 \
  "$repo_dir/deploy/Caddyfile" \
  /etc/caddy/Caddyfile

cat > /etc/sudoers.d/gc-go-deploy <<'EOF'
nmfairus ALL=(root) NOPASSWD: /usr/bin/systemctl restart gc-go-api
EOF
chmod 0440 /etc/sudoers.d/gc-go-deploy
visudo --check --file=/etc/sudoers.d/gc-go-deploy

systemctl daemon-reload
systemctl enable gc-go-api.service
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy.service
systemctl reload caddy.service

echo "Provisioning completed."
go version
node --version
npm --version
caddy version

if [[ ! -f "$repo_dir/api/.env" ]]; then
  echo "Next: create $repo_dir/api/.env before starting gc-go-api.service."
fi
