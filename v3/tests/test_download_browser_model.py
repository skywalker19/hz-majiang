import builtins
import hashlib
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import download_browser_model as downloader


class BrowserModelDownloadTests(unittest.TestCase):
    def test_loads_without_dataclasses_on_older_python(self):
        original_import = builtins.__import__

        def import_without_dataclasses(name, *args, **kwargs):
            if name == 'dataclasses':
                raise ImportError('No module named dataclasses')
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=import_without_dataclasses):
            namespace = runpy.run_path(str(Path(downloader.__file__)), run_name='compatibility_check')
        self.assertEqual(namespace['FILES'][0].name, 'config.json')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.content = b'fake model contents for integrity checking'
        self.spec = downloader.ModelFile('onnx/example.onnx', len(self.content), 'sha256',
                                         hashlib.sha256(self.content).hexdigest())

    def test_resumes_partial_file_and_publishes_only_verified_content(self):
        pending = self.root / 'onnx/example.onnx.part'
        pending.parent.mkdir()
        pending.write_bytes(self.content[:7])

        def finish_download(command, **kwargs):
            self.assertIn('--continue-at', command)
            self.assertEqual(Path(command[command.index('--output') + 1]), pending)
            with pending.open('ab') as output:
                output.write(self.content[7:])

        with patch.object(downloader.subprocess, 'run', side_effect=finish_download):
            downloader.download_file(self.root, self.spec)
        self.assertEqual((self.root / self.spec.name).read_bytes(), self.content)
        self.assertFalse(pending.exists())

    def test_valid_files_are_reused_without_network(self):
        target = self.root / self.spec.name
        target.parent.mkdir()
        target.write_bytes(self.content)
        with patch.object(downloader.subprocess, 'run') as curl:
            downloader.download_file(self.root, self.spec)
            curl.assert_not_called()

    def test_failed_or_corrupt_download_does_not_replace_existing_file(self):
        target = self.root / self.spec.name
        target.parent.mkdir()
        target.write_bytes(b'previous file')

        def corrupt_download(command, **kwargs):
            Path(command[command.index('--output') + 1]).write_bytes(b'X' * len(self.content))

        original_unlink = Path.unlink

        def python36_unlink(path):
            return original_unlink(path)

        with patch.object(downloader.subprocess, 'run', side_effect=corrupt_download), \
                patch.object(Path, 'unlink', autospec=True, side_effect=python36_unlink):
            with self.assertRaisesRegex(RuntimeError, 'Integrity check failed'):
                downloader.download_file(self.root, self.spec)
        self.assertEqual(target.read_bytes(), b'previous file')
        with patch.object(downloader.subprocess, 'run', side_effect=subprocess.CalledProcessError(7, 'curl')):
            with self.assertRaises(subprocess.CalledProcessError):
                downloader.download_file(self.root, self.spec)
        self.assertEqual(target.read_bytes(), b'previous file')

    def test_git_blob_digest_checks_the_upstream_metadata_format(self):
        target = self.root / 'config.json'
        target.write_bytes(self.content)
        digest = hashlib.sha1(('blob %d\0' % len(self.content)).encode() + self.content).hexdigest()
        spec = downloader.ModelFile('config.json', len(self.content), 'git-sha1', digest)
        self.assertTrue(downloader.verified(target, spec))
        target.write_bytes(b'X' * len(self.content))
        self.assertFalse(downloader.verified(target, spec))


if __name__ == '__main__':
    unittest.main()
