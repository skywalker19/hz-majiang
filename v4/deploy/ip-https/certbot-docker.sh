#!/usr/bin/env bash
set -euo pipefail

# Install as /usr/local/sbin/mahjong-certbot. Requires Docker on the host.
if [[ ${EUID} -ne 0 ]]; then
  echo 'Run this command as root.' >&2
  exit 1
fi
MAHJONG_DOCKER=$(command -v docker) || { echo 'Docker is required.' >&2; exit 1; }
MAHJONG_CERTBOT_IMAGE=certbot/certbot:v5.8.0
mkdir -p /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt /var/www/.well-known/acme-challenge
MAHJONG_RUN=(run --rm --name mahjong-certbot
  -v /etc/letsencrypt:/etc/letsencrypt
  -v /var/lib/letsencrypt:/var/lib/letsencrypt
  -v /var/log/letsencrypt:/var/log/letsencrypt
  -v /var/www/.well-known/acme-challenge:/var/www/.well-known/acme-challenge)
if [[ -t 0 && -t 1 ]]; then MAHJONG_RUN+=(-it); fi
exec "$MAHJONG_DOCKER" "${MAHJONG_RUN[@]}" "$MAHJONG_CERTBOT_IMAGE" "$@"
