#!/usr/bin/env bash
# Run on the NEW Ubuntu server. Does not change SSH, firewall or OpenVPN rules.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST='' EMAIL='' INSTALL=0 HTTP_ONLY=0 RENDER=0 AGREE=0
usage() {
  cat <<'HELP'
Usage: sudo bash setup-ubuntu.sh --host PUBLIC_IP_OR_DOMAIN [options]
  --install-deps   Install Nginx and Docker Engine on Ubuntu 24.04/26.04
  --http-only      Configure HTTP only for initial testing (no certificate)
  --email EMAIL   ACME registration email (otherwise Certbot asks interactively)
  --agree-tos     Accept ACME terms; requires --email and runs non-interactively
  --render-only   Print HTTP Nginx configuration; no root or host changes needed

Manages only /etc/nginx/sites-available/apps06.conf and its matching symlink.
Routes /eatwise/ to loopback:8088 and /majiang/ to /var/www/hz-majiang/current/.
Open TCP 80/443 in the cloud security group before issuing the certificate.
HELP
}
while (($#)); do
  case "$1" in
    --host|--email)
      (($# >= 2)) || { usage >&2; exit 2; }
      if [[ $1 == --host ]]; then HOST=$2; else EMAIL=$2; fi; shift 2 ;;
    --install-deps) INSTALL=1; shift ;;
    --http-only) HTTP_ONLY=1; shift ;;
    --render-only) RENDER=1; shift ;;
    --agree-tos) AGREE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -n "$HOST" ]] || { usage >&2; exit 2; }
python3 "$ROOT/site-config.py" --host "$HOST" >/dev/null
if ((RENDER)); then exec python3 "$ROOT/site-config.py" --host "$HOST"; fi
[[ $EUID == 0 ]] || { echo 'Run as root on the new Ubuntu host.' >&2; exit 1; }
(( ! AGREE )) || [[ -n "$EMAIL" ]] || { echo '--agree-tos requires --email.' >&2; exit 2; }
[[ -z "$EMAIL" || "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Invalid email.' >&2; exit 2; }
source /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 24.04 || $VERSION_ID == 26.04 ) ]] || { echo 'This bootstrap supports Ubuntu 24.04/26.04 only.' >&2; exit 1; }
config=/etc/nginx/sites-available/apps06.conf
enabled=/etc/nginx/sites-enabled/apps06.conf
if [[ -e "$config" ]]; then
  grep -qx '# managed-by: apps06-aliyun' "$config" || { echo "Refusing unmanaged config: $config" >&2; exit 1; }
  grep -qxF "# public-host: $HOST" "$config" || { echo 'Existing managed host differs; review certificate and Nginx changes manually.' >&2; exit 1; }
fi
if [[ -e "$enabled" || -L "$enabled" ]]; then
  [[ -L "$enabled" && $(readlink "$enabled") == "$config" ]] || { echo "Refusing unmanaged entry: $enabled" >&2; exit 1; }
fi
exec 8>/run/lock/apps06-setup.lock
flock -n 8 || { echo 'Another setup is running.' >&2; exit 1; }
if ((INSTALL)); then
  apt-get update
  apt-get install -y ca-certificates curl nginx python3 rsync
  if ! command -v docker >/dev/null; then
    for pkg in docker.io docker-compose podman-docker containerd runc; do
      if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
        echo "Existing $pkg may conflict with Docker CE; resolve the installation manually." >&2; exit 1
      fi
    done
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod 0644 /etc/apt/keyrings/docker.asc
    cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
for cmd in docker nginx curl systemctl; do command -v "$cmd" >/dev/null || { echo "Missing $cmd; use --install-deps." >&2; exit 1; }; done
systemctl enable --now docker nginx
docker info >/dev/null
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /var/backups/apps06 /var/www/.well-known/acme-challenge

install_config() {
  local mode=$1 pending backup='' existed=0 linked=0
  pending=$(mktemp /etc/nginx/sites-available/.apps06.XXXXXX)
  if [[ $mode == https ]]; then
    python3 "$ROOT/site-config.py" --host "$HOST" --https > "$pending"
  else
    python3 "$ROOT/site-config.py" --host "$HOST" > "$pending"
  fi
  if [[ -f "$config" ]]; then
    existed=1; backup=$(mktemp /var/backups/apps06/nginx.XXXXXX); cp -p "$config" "$backup"
  fi
  if [[ -L "$enabled" ]]; then linked=1; fi
  chmod 0644 "$pending"; mv -f "$pending" "$config"
  if (( ! linked )); then ln -s "$config" "$enabled"; fi
  if ! nginx -t || ! systemctl reload nginx; then
    if ((existed)); then cp -p "$backup" "$config"; else rm -- "$config"; fi
    if (( ! linked )); then rm -- "$enabled"; fi
    nginx -t && systemctl reload nginx || true
    echo 'Nginx setup failed; previous managed configuration restored.' >&2; return 1
  fi
}

# Preserve HTTPS on repeat runs; do not downgrade an existing managed site.
if [[ -s /etc/letsencrypt/live/apps06/fullchain.pem && -s /etc/letsencrypt/live/apps06/privkey.pem ]]; then
  install_config https
else
  install_config http
fi
if ((HTTP_ONLY)); then echo 'Nginx configured; existing HTTPS was preserved. No certificate operation was performed by this run.'; exit 0; fi
probe="apps06-$(date +%s)-$RANDOM"
printf '%s' "$probe" > "/var/www/.well-known/acme-challenge/$probe"
trap 'rm -f -- "/var/www/.well-known/acme-challenge/$probe"' EXIT
response=$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 10 --max-time 20 "http://$HOST/.well-known/acme-challenge/$probe")
[[ "$response" == "$probe" ]] || { echo 'Public HTTP challenge does not reach this host.' >&2; exit 1; }
install -m 0755 "$ROOT/certbot.sh" /usr/local/sbin/apps06-certbot
certargs=(certonly --cert-name apps06 --keep-until-expiring --preferred-challenges http --webroot --webroot-path /var/www)
if python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$HOST" 2>/dev/null; then
  certargs+=(--preferred-profile shortlived --ip-address "$HOST")
else
  certargs+=(-d "$HOST")
fi
if [[ -n "$EMAIL" ]]; then certargs+=(--email "$EMAIL"); fi
if ((AGREE)); then certargs+=(--agree-tos --non-interactive); fi
/usr/local/sbin/apps06-certbot "${certargs[@]}"
install_config https
install -m 0755 "$ROOT/renew.sh" /usr/local/sbin/apps06-certbot-renew
cat > /etc/systemd/system/apps06-certbot-renew.service <<'EOF'
[Unit]
Description=Renew apps06 certificate and reload host Nginx
Requires=docker.service
After=network-online.target docker.service nginx.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/apps06-certbot-renew
EOF
cat > /etc/systemd/system/apps06-certbot-renew.timer <<'EOF'
[Unit]
Description=Check apps06 certificate every six hours
[Timer]
OnCalendar=*-*-* 00,06,12,18:23:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now apps06-certbot-renew.timer
curl --noproxy '*' --fail --silent --show-error --max-time 20 "https://$HOST/.well-known/acme-challenge/$probe" >/dev/null
printf 'HTTPS configured for %s; renewal timer enabled. Deploy and verify both apps next.\n' "$HOST"
