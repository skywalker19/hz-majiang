#!/usr/bin/env bash
set -euo pipefail
marker=/var/lib/letsencrypt/apps06-nginx-reload
/usr/local/sbin/apps06-certbot renew --cert-name apps06 --non-interactive --quiet \
  --no-random-sleep-on-renew --deploy-hook "touch $marker"
if [[ -f "$marker" ]]; then
  nginx -t
  systemctl reload nginx
  rm -- "$marker"
fi
