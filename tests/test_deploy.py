import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deploy_static', ROOT / 'scripts/deploy-static.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.root = self.path / 'hz-majiang'

    def bundle(self, version, extra=None):
        path = self.path / (version + '.tar.gz')
        files = {name: (version + ':' + name).encode() for name in deploy.REQUIRED}
        manifest = {'release_id': version, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        files['release.json'] = json.dumps(manifest).encode()
        if extra:
            files.update(extra)
        with tarfile.open(path, 'w:gz') as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        return path

    def install(self, version, **kwargs):
        archive = self.bundle(version)
        return deploy.deploy(self.root, archive, deploy.sha(archive), **kwargs)

    def test_two_releases_and_rollback_preserve_previous_files(self):
        self.install('one')
        self.install('two')
        self.assertEqual((self.root / 'current/index.html').read_text(), 'two:index.html')
        self.assertEqual((self.root / 'previous/index.html').read_text(), 'one:index.html')
        deploy.deploy(self.root, rollback=True)
        self.assertEqual((self.root / 'current/index.html').read_text(), 'one:index.html')
        self.assertEqual((self.root / 'previous/index.html').read_text(), 'two:index.html')

    def test_path_traversal_is_rejected_and_current_unchanged(self):
        self.install('one')
        archive = self.bundle('bad', {'../../escape.txt': b'bad'})
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            deploy.deploy(self.root, archive, deploy.sha(archive))
        self.assertEqual((self.root / 'current').resolve().name, 'one')
        self.assertFalse((self.path / 'escape.txt').exists())

    def test_checksum_mismatch_does_not_replace_current(self):
        self.install('one')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            deploy.deploy(self.root, self.bundle('two'), '0' * 64)
        self.assertEqual((self.root / 'current').resolve().name, 'one')

    def test_refuses_existing_unmanaged_site(self):
        self.root.mkdir()
        (self.root / 'index.html').write_text('existing site')
        with self.assertRaisesRegex(ValueError, 'unmanaged'):
            self.install('one')
        self.assertEqual((self.root / 'index.html').read_text(), 'existing site')

    def test_current_cannot_point_outside_release_root(self):
        deploy.prepare_root(self.root)
        outside = self.path / 'outside'
        outside.mkdir()
        (self.root / 'current').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.install('one')

    def test_wrong_http_content_restores_working_release(self):
        self.install('one')
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'a different site')
            def log_message(self, *args):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(ValueError, 'HTTP response'):
                self.install('two', check_url='http://127.0.0.1:%s/' % server.server_port)
            self.assertEqual((self.root / 'current').resolve().name, 'one')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_real_builder_package_is_accepted_and_has_no_model_or_secret_files(self):
        archive = self.path / 'release.tar.gz'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/publish.py'), '--package-only', str(archive)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        deploy.deploy(self.root, archive, deploy.sha(archive))
        html = (self.root / 'current/index.html').read_text()
        self.assertIn('赏桂品茗国粹馆', html)
        self.assertFalse((self.root / 'current/models').exists())
        self.assertEqual(len(list((self.root / 'current/icons').glob('*.png'))), 3)

    def test_dry_run_requires_explicit_target_and_never_uses_ssh(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/publish.py'), '--target', 'root@198.51.100.10', '--dry-run'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SSH and SCP were not called', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
