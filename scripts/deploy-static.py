#!/usr/bin/env python3
"""Install a verified static release and atomically switch its current symlink."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import urllib.request

MARKER = 'hz-majiang-static-v1\n'
REQUIRED = {'index.html', 'site.webmanifest', 'apple-touch-icon.png',
            'icons/mahjong.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png'}


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def valid_name(name):
    path = PurePosixPath(name)
    return not path.is_absolute() and '..' not in path.parts and (
        name in REQUIRED or re.fullmatch(r'icons/[a-zA-Z0-9_.-]+\.(png|svg)', name))


def prepare_root(root):
    if not root.is_absolute() or root.name != 'hz-majiang' or '..' in root.parts or root.is_symlink():
        raise ValueError('Root must be an absolute, non-symlink directory ending in /hz-majiang.')
    root.mkdir(parents=True, exist_ok=True)
    marker = root / '.managed-by-publisher'
    if marker.exists():
        if marker.is_symlink() or marker.read_text() != MARKER:
            raise ValueError('Unrecognized deployment marker.')
    else:
        if any(root.iterdir()):
            raise ValueError('Refusing a nonempty unmanaged directory; use a fresh deployment root.')
        marker.write_text(MARKER)
    releases = root / 'releases'
    if releases.is_symlink():
        raise ValueError('Release directory must not be a symlink.')
    releases.mkdir(exist_ok=True)
    os.chmod(root, 0o755)
    os.chmod(releases, 0o755)
    return releases


def pointer(root, name):
    link = root / name
    if not link.exists() and not link.is_symlink():
        return None
    if not link.is_symlink():
        raise ValueError(name + ' must be a managed symlink, not an existing directory.')
    target = link.resolve(strict=True)
    if target.parent != (root / 'releases').resolve() or not target.is_dir():
        raise ValueError('Symlink points outside the release directory.')
    return target


def point(root, name, target):
    link = root / name
    pending = root / ('.' + name + '-' + str(os.getpid()))
    if pending.exists() or pending.is_symlink():
        raise ValueError('Temporary symlink already exists.')
    pending.symlink_to(Path('releases') / target.name)
    os.replace(pending, link)


def check_http(url, host, expected):
    if not url:
        return
    if not url.startswith(('http://', 'https://')):
        raise ValueError('HTTP check URL must use http:// or https://.')
    headers = {'User-Agent': 'Mahjong deploy probe'}
    if host:
        if not re.fullmatch(r'[a-zA-Z0-9.-]+(?::[0-9]+)?', host):
            raise ValueError('Invalid HTTP Host header.')
        headers['Host'] = host
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
        body = response.read(32 * 1024 * 1024 + 1)
    if hashlib.sha256(body).hexdigest() != expected:
        raise ValueError('HTTP response does not match the installed index.html; restoring current.')


def unpack(archive, expected_sha, releases):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha or '') or sha(archive) != expected_sha:
        raise ValueError('Release archive SHA-256 mismatch.')
    with tarfile.open(archive, 'r:gz') as handle:
        members = handle.getmembers()
        if len(members) > 1000 or sum(m.size for m in members) > 32 * 1024 * 1024:
            raise ValueError('Static archive is too large.')
        names = [m.name for m in members]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive member.')
        for member in members:
            if not member.isfile() or (member.name != 'release.json' and not valid_name(member.name)):
                raise ValueError('Unsafe or unexpected archive member: ' + member.name)
        if 'release.json' not in names:
            raise ValueError('Missing release manifest.')
        manifest = json.load(handle.extractfile('release.json'))
        release_id = manifest.get('release_id', '')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', release_id):
            raise ValueError('Invalid release ID.')
        hashes = manifest.get('files', {})
        if not isinstance(hashes, dict) or set(hashes) != set(names) - {'release.json'} or not REQUIRED.issubset(hashes):
            raise ValueError('Manifest file inventory does not match the archive.')
        destination = releases / release_id
        destination.mkdir(mode=0o755)  # Releases are immutable; collisions are errors.
        try:
            for member in members:
                target = destination / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with handle.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                os.chmod(target, 0o644)
                if member.name != 'release.json' and sha(target) != hashes[member.name]:
                    raise ValueError('Release file checksum mismatch: ' + member.name)
            for directory, subdirs, files in os.walk(destination):
                os.chmod(directory, 0o755)
        except Exception:
            shutil.rmtree(destination)
            raise
    return destination, manifest


def deploy(root, archive=None, expected_sha=None, rollback=False, check_url=None, host=None):
    releases = prepare_root(root)
    with (root / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = pointer(root, 'current')
        previous = pointer(root, 'previous')
        if rollback:
            if not previous:
                raise ValueError('No previous release is available.')
            candidate = previous
            manifest = json.loads((candidate / 'release.json').read_text())
            for name, expected in manifest['files'].items():
                if not valid_name(name) or sha(candidate / name) != expected:
                    raise ValueError('Rollback release checksum mismatch.')
        else:
            if archive is None:
                raise ValueError('An archive is required.')
            candidate, manifest = unpack(archive, expected_sha, releases)
        point(root, 'current', candidate)
        try:
            check_http(check_url, host, manifest['files']['index.html'])
        except Exception:
            if old:
                point(root, 'current', old)
            else:
                (root / 'current').unlink()
            raise
        if old and old != candidate:
            point(root, 'previous', old)
        return {'release_id': manifest['release_id'], 'current': str(candidate),
                'index_sha256': manifest['files']['index.html'], 'http_verified': bool(check_url)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/var/www/hz-majiang'))
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--check-url')
    parser.add_argument('--public-host')
    args = parser.parse_args()
    if args.rollback and (args.archive or args.sha256):
        parser.error('--rollback cannot be combined with an archive.')
    try:
        print(json.dumps(deploy(args.root, args.archive, args.sha256, args.rollback, args.check_url, args.public_host), ensure_ascii=True))
    except Exception as exc:
        parser.exit(1, 'Deployment failed: ' + str(exc) + '\n')


if __name__ == '__main__':
    main()
