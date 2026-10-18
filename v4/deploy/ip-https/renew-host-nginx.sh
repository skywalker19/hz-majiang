#!/usr/bin/env bash
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# For Nginx installed on the HOST; containerized Nginx needs its own reload command.
MAHJONG_NGINX=$(command -v nginx || true)
if [[ -z "$MAHJONG_NGINX" && -x /usr/local/nginx/sbin/nginx ]]; then
  MAHJONG_NGINX=/usr/local/nginx/sbin/nginx
fi
if [[ -z "$MAHJONG_NGINX" ]]; then
  echo 'Host Nginx was not found. Configure a reload command for your deployment.' >&2
  exit 1
fi
MAHJONG_RELOAD_MARKER=/var/lib/letsencrypt/mahjong-nginx-reload
/usr/local/sbin/mahjong-certbot renew --cert-name mahjong-ip \
  --non-interactive --quiet --no-random-sleep-on-renew \
  --deploy-hook 'touch /var/lib/letsencrypt/mahjong-nginx-reload'
if [[ -f "$MAHJONG_RELOAD_MARKER" ]]; then
  "$MAHJONG_NGINX" -t
  "$MAHJONG_NGINX" -s reload
  rm -- "$MAHJONG_RELOAD_MARKER"
fi
