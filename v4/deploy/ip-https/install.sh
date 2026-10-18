#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Tailored to the server configuration supplied by the user on 2026-10-18.
MAHJONG_IP=150.109.196.200
MAHJONG_NGINX=/usr/sbin/nginx
MAHJONG_CONF=/etc/nginx/conf.d/drip-monitor.conf
MAHJONG_SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MAHJONG_CHALLENGE=/var/www/.well-known/acme-challenge
MAHJONG_CHAIN=/etc/letsencrypt/live/mahjong-ip/fullchain.pem
MAHJONG_KEY=/etc/letsencrypt/live/mahjong-ip/privkey.pem

if [[ ${EUID} -ne 0 ]]; then echo 'Please run as root.' >&2; exit 1; fi
for MAHJONG_COMMAND in docker curl systemctl install mktemp sed grep; do
  command -v "$MAHJONG_COMMAND" >/dev/null || { echo "Missing: $MAHJONG_COMMAND" >&2; exit 1; }
done
[[ -x "$MAHJONG_NGINX" && -f "$MAHJONG_CONF" ]] || { echo 'Expected host Nginx configuration was not found.' >&2; exit 1; }
"$MAHJONG_NGINX" -t

# Reuse the existing /var/www challenge route. Do not rewrite an HTTP server block.
mkdir -p "$MAHJONG_CHALLENGE"
MAHJONG_PROBE=mahjong-acme-ready-$(date +%s)-${RANDOM}
printf '%s\n' "$MAHJONG_PROBE" > "$MAHJONG_CHALLENGE/mahjong-check"
if ! MAHJONG_RESPONSE=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 20 \
  "http://$MAHJONG_IP/.well-known/acme-challenge/mahjong-check"); then
  echo 'The HTTP challenge route is not reachable. No certificate paths have been changed.' >&2
  echo 'Inspect the existing ACME location in /etc/nginx/conf.d/drip-monitor.conf before retrying.' >&2
  exit 1
fi
if [[ "$MAHJONG_RESPONSE" != "$MAHJONG_PROBE" ]]; then
  echo 'The challenge URL did not return the expected file. No certificate paths have been changed.' >&2
  exit 1
fi

install -m 755 "$MAHJONG_SOURCE/certbot-docker.sh" /usr/local/sbin/mahjong-certbot
echo 'Requesting a production IP certificate. Follow the Certbot email and terms prompts.'
/usr/local/sbin/mahjong-certbot certonly \
  --cert-name mahjong-ip --preferred-profile shortlived --preferred-challenges http \
  --webroot --webroot-path /var/www --ip-address "$MAHJONG_IP"
[[ -s "$MAHJONG_CHAIN" && -s "$MAHJONG_KEY" ]] || { echo 'Certificate files are missing.' >&2; exit 1; }

# Match the two known directives; stop if the configuration has since changed.
if grep -Eq '^[[:space:]]*ssl_certificate[[:space:]]+/etc/nginx/ssl/selfsigned\.crt[[:space:]]*;' "$MAHJONG_CONF" \
  && grep -Eq '^[[:space:]]*ssl_certificate_key[[:space:]]+/etc/nginx/ssl/selfsigned\.key[[:space:]]*;' "$MAHJONG_CONF"; then
  MAHJONG_BACKUP=$(mktemp "$MAHJONG_CONF.mahjong-backup.XXXXXX")
  cp -p "$MAHJONG_CONF" "$MAHJONG_BACKUP"
  sed -i \
    -e 's#/etc/nginx/ssl/selfsigned\.crt#/etc/letsencrypt/live/mahjong-ip/fullchain.pem#g' \
    -e 's#/etc/nginx/ssl/selfsigned\.key#/etc/letsencrypt/live/mahjong-ip/privkey.pem#g' \
    "$MAHJONG_CONF"
  if ! "$MAHJONG_NGINX" -t; then
    cp -p "$MAHJONG_BACKUP" "$MAHJONG_CONF"
    echo "Restored original configuration. Backup: $MAHJONG_BACKUP" >&2
    exit 1
  fi
  if ! "$MAHJONG_NGINX" -s reload; then
    cp -p "$MAHJONG_BACKUP" "$MAHJONG_CONF"
    echo "Reload failed; original configuration restored. Backup: $MAHJONG_BACKUP" >&2
    exit 1
  fi
  echo "Original configuration saved at $MAHJONG_BACKUP"
elif grep -Eq '^[[:space:]]*ssl_certificate[[:space:]]+/etc/letsencrypt/live/mahjong-ip/fullchain\.pem[[:space:]]*;' "$MAHJONG_CONF" \
  && grep -Eq '^[[:space:]]*ssl_certificate_key[[:space:]]+/etc/letsencrypt/live/mahjong-ip/privkey\.pem[[:space:]]*;' "$MAHJONG_CONF"; then
  "$MAHJONG_NGINX" -t
  "$MAHJONG_NGINX" -s reload
else
  echo 'Certificate issued, but the expected Nginx certificate directives have changed. Configure them manually.' >&2
  exit 1
fi

# Install renewal before the final public HTTPS check, so it remains scheduled if that check fails.
install -m 755 "$MAHJONG_SOURCE/renew-host-nginx.sh" /usr/local/sbin/mahjong-certbot-renew
install -m 644 "$MAHJONG_SOURCE/mahjong-certbot-renew.service" /etc/systemd/system/mahjong-certbot-renew.service
install -m 644 "$MAHJONG_SOURCE/mahjong-certbot-renew.timer" /etc/systemd/system/mahjong-certbot-renew.timer
systemctl daemon-reload
systemctl enable mahjong-certbot-renew.timer
systemctl start mahjong-certbot-renew.timer
systemctl list-timers mahjong-certbot-renew.timer
curl --fail --silent --show-error --head --connect-timeout 10 --max-time 20 \
  "https://$MAHJONG_IP/majiang/apple-touch-icon.png"
echo 'HTTPS certificate configured and renewal scheduled. Confirm the Home Screen icon on your iPhone.'
