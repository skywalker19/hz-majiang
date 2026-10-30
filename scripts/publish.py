#!/usr/bin/env python3
"""Build and publish the static v4 site over ordinary SSH."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SSH_OPTIONS = ['-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no',
               '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package(output, release_id):
    subprocess.run(['node', str(ROOT / 'v4/scripts/build-single-file.mjs')], check=True)
    dist = ROOT / 'v4/dist'
    files = [dist / name for name in ('index.html', 'site.webmanifest', 'apple-touch-icon.png')]
    files += sorted((dist / 'icons').glob('*'))
    if any(p.is_symlink() or not p.is_file() for p in files):
        raise ValueError('Only regular static files may be published.')
    if any(p.parent.name == 'icons' and not re.fullmatch(r'[a-zA-Z0-9_.-]+\.(png|svg)', p.name) for p in files):
        raise ValueError('Unexpected icon file.')
    manifest = {'release_id': release_id, 'files': {p.relative_to(dist).as_posix(): digest(p) for p in files}}
    with tempfile.TemporaryDirectory(prefix='mahjong-manifest-') as folder:
        meta = Path(folder) / 'release.json'
        meta.write_text(json.dumps(manifest, ensure_ascii=True, indent=2))
        with tarfile.open(output, 'x:gz') as handle:
            def clean(info):
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mode = 0o644
                return info
            for p in files:
                handle.add(p, arcname=p.relative_to(dist).as_posix(), recursive=False, filter=clean)
            handle.add(meta, arcname='release.json', filter=clean)
    os.chmod(output, 0o600)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', default=os.environ.get('MAHJONG_TARGET') or os.environ.get('ALIYUN_SSH_TARGET'))
    parser.add_argument('--port', type=int, default=22)
    parser.add_argument('--remote-dir', default='/var/www/hz-majiang')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--package-only', type=Path)
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--check-url', help='Optional URL returning the exact deployed index.html')
    parser.add_argument('--public-host', help='Optional Host header for the HTTP check')
    args = parser.parse_args()
    if args.rollback and args.package_only:
        parser.error('--rollback cannot be combined with --package-only.')
    if not 1 <= args.port <= 65535:
        parser.error('Invalid SSH port.')
    if not re.fullmatch(r'/[a-zA-Z0-9_./-]+/hz-majiang', args.remote_dir) or '..' in Path(args.remote_dir).parts or '//' in args.remote_dir:
        parser.error('Remote directory must be an absolute path ending in /hz-majiang.')
    if not args.package_only and (not args.target or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*', args.target)):
        parser.error('Supply --target USER@HOST or MAHJONG_TARGET; there is no implicit production target.')
    if not args.dry_run and not args.package_only and not sys.stdin.isatty():
        parser.error('Run from an interactive terminal for SSH password prompts.')
    release_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix='mahjong-publish-') as folder:
        archive = Path(folder) / ('mahjong-' + release_id + '.tar.gz')
        manifest = None if args.rollback else package(archive, release_id)
        if args.package_only:
            output = args.package_only.expanduser().resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('xb') as target, archive.open('rb') as source:
                shutil.copyfileobj(source, target)
            os.chmod(output, 0o600)
            print('Package:', output)
            return 0
        print(json.dumps({'target': args.target, 'remote_directory': args.remote_dir,
                          'release': manifest, 'rollback': args.rollback}, ensure_ascii=True))
        if args.dry_run:
            print('Preview complete; SSH and SCP were not called.')
            return 0
        installer = Path(folder) / ('mahjong-' + release_id + '.py')
        shutil.copyfile(ROOT / 'scripts/deploy-static.py', installer)
        uploads = [str(installer)] + ([] if args.rollback else [str(archive)])
        subprocess.run(['scp', *SSH_OPTIONS, '-P', str(args.port), *uploads, args.target + ':/tmp/'], check=True)
        remote_script = '/tmp/' + installer.name
        words = ['python3', remote_script, '--root', args.remote_dir]
        if args.rollback:
            words += ['--rollback']
        else:
            words += ['--archive', '/tmp/' + archive.name, '--sha256', digest(archive)]
        if args.check_url:
            words += ['--check-url', args.check_url]
        if args.public_host:
            words += ['--public-host', args.public_host]
        cleanup = 'rm -f -- ' + ' '.join(shlex.quote('/tmp/' + Path(p).name) for p in uploads)
        command = 'trap ' + shlex.quote(cleanup) + ' EXIT; ' + ' '.join(shlex.quote(word) for word in words)
        subprocess.run(['ssh', *SSH_OPTIONS, '-p', str(args.port), '-t', args.target, command], check=True)
        print('Static release installed.' if not args.check_url else 'Static release installed and HTTP content verified.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print('Publish failed: ' + str(exc), file=sys.stderr)
        sys.exit(1)
