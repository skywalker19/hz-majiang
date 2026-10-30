#!/usr/bin/env python3
"""Render the two-app Nginx site without touching the host."""
import argparse
import ipaddress
import re


def validate_host(host):
    try:
        address = ipaddress.ip_address(host)
        if address.version != 4:
            raise ValueError('Use an IPv4 address or a DNS hostname.')
    except ValueError:
        if not re.fullmatch(r'(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z][a-zA-Z0-9-]*', host):
            raise ValueError('Invalid public hostname or IPv4 address.')
    return host


def render(host, https=False):
    validate_host(host)
    routes = '''
    location = /eatwise { return 308 /eatwise/; }
    location ^~ /eatwise/ {
        access_log off;
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 20s;
    }
    location = /majiang { return 308 /majiang/; }
    location ^~ /majiang/ {
        alias /var/www/hz-majiang/current/;
        index index.html;
    }
    location / { return 404; }
'''
    challenge = '    location ^~ /.well-known/acme-challenge/ { root /var/www; }\n'
    head = '# managed-by: apps06-aliyun\n# public-host: ' + host + '\n'
    if not https:
        return head + 'server {\n    listen 80;\n    server_name ' + host + ';\n' + challenge + routes + '}\n'
    return (head + 'server {\n    listen 80;\n    server_name ' + host + ';\n' + challenge +
            '    location / { return 308 https://$host$request_uri; }\n}\n' +
            'server {\n    listen 443 ssl;\n    server_name ' + host + ';\n' +
            '    ssl_certificate /etc/letsencrypt/live/apps06/fullchain.pem;\n' +
            '    ssl_certificate_key /etc/letsencrypt/live/apps06/privkey.pem;\n' +
            '    ssl_protocols TLSv1.2 TLSv1.3;\n' + challenge + routes + '}\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--https', action='store_true')
    args = parser.parse_args()
    try:
        print(render(args.host, args.https), end='')
    except ValueError as exc:
        parser.error(str(exc))
