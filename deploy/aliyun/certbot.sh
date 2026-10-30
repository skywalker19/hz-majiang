#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
exec 9>/run/lock/apps06-certbot.lock
flock -n 9 || { echo 'Another certificate operation is running.' >&2; exit 1; }
mkdir -p /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt /var/www/.well-known/acme-challenge
args=(run --rm --name apps06-certbot
  -v /etc/letsencrypt:/etc/letsencrypt
  -v /var/lib/letsencrypt:/var/lib/letsencrypt
  -v /var/log/letsencrypt:/var/log/letsencrypt
  -v /var/www/.well-known/acme-challenge:/var/www/.well-known/acme-challenge)
if [[ -t 0 && -t 1 ]]; then args+=(-it); fi
exec docker "${args[@]}" certbot/certbot:v5.8.0 "$@"
