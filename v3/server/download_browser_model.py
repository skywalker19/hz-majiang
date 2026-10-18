"""Prepare public Qwen3 Q4F16 files for browser download; requires Python 3 and curl."""
import argparse
from dataclasses import dataclass
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'
REVISION = '58ca03a5e7b354b480b1a82b34bde8dc7b854cc0'


@dataclass(frozen=True)
class ModelFile:
    name: str
    size: int
    algorithm: str
    digest: str
    repository: str = MODEL_ID
    revision: str = REVISION


# Upstream Git blob IDs cover small files; LFS SHA-256 covers the large files.
# Fetch only the selected quantization, not every ONNX variant in the repository.
FILES = (
    ModelFile('config.json', 912, 'git-sha1', '5618bd85d36283349a0cb4a99ab15454691f355b'),
    ModelFile('generation_config.json', 219, 'git-sha1', 'f0e014517edce509b5d5f07cfa4855d79fad3bcf'),
    ModelFile('tokenizer.json', 9117040, 'sha256', 'e7a95fce95bf5b0946d0ddb3f9d7caa030b7e850bbe92b0edb26bcf563e9f3d5'),
    ModelFile('tokenizer_config.json', 10369, 'git-sha1', 'f658735e1ad9b8feb5a3c5140e659e854889af61'),
    ModelFile('special_tokens_map.json', 613, 'git-sha1', 'ac23c0aaa2434523c494330aeb79c58395378103'),
    ModelFile('added_tokens.json', 707, 'git-sha1', 'b54f9135e44c1e81047e8d05cb027af8bc039eed'),
    ModelFile('chat_template.jinja', 4116, 'git-sha1', '699ff8df401fe4788525e9c1f9b86a99eadd6230'),
    ModelFile('vocab.json', 2776833, 'git-sha1', '4783fe10ac3adce15ac8f358ef5462739852c569'),
    ModelFile('merges.txt', 1671853, 'git-sha1', '31349551d90c7606f325fe0f11bbb8bd5fa0d7c7'),
    ModelFile('README.md', 1539, 'git-sha1', 'bb4c96a7b31a2ba8660a48adca819d5047051dc5'),
    ModelFile('onnx/model_q4f16.onnx', 569789750, 'sha256', '9e33a5911974174761d0dfdcc0bec975d9c45af0eae5e9eb647b8ba9442a8f91'),
    ModelFile('LICENSE', 11343, 'git-sha1', '6634c8cc3133b3848ec74b9f275acaaa1ea618ab',
              'Qwen/Qwen3-0.6B', 'c1899de289a04d12100db370d81485cdf75e47ca'),
)


def verified(path, spec):
    if not path.is_file() or path.stat().st_size != spec.size:
        return False
    digest = hashlib.sha1() if spec.algorithm == 'git-sha1' else hashlib.sha256()
    if spec.algorithm == 'git-sha1':
        digest.update(('blob %d\0' % spec.size).encode())
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest() == spec.digest


def download_file(root, spec):
    target = root / spec.name
    if verified(target, spec):
        print('Already verified: ' + spec.name, flush=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_name(target.name + '.part')
    if pending.exists() and pending.stat().st_size >= spec.size and not verified(pending, spec):
        pending.unlink()
    if not verified(pending, spec):
        url = 'https://huggingface.co/%s/resolve/%s/%s' % (spec.repository, spec.revision, spec.name)
        print('Downloading: ' + spec.name, flush=True)
        # curl resumes .part files and retries connection failures without loading weights in RAM.
        subprocess.run([
            'curl', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
            '--retry', '3', '--retry-delay', '2', '--connect-timeout', '20',
            '--continue-at', '-', '--progress-bar', '--output', str(pending), url,
        ], check=True)
    if not verified(pending, spec):
        pending.unlink(missing_ok=True)
        raise RuntimeError('Integrity check failed: ' + spec.name + '; run the command again.')
    pending.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent / 'browser-models',
                        help='Public model base directory (the repository directory is created inside it).')
    parser.add_argument('--verify-only', action='store_true', help='Check all files without accessing the network.')
    args = parser.parse_args()
    root = args.output_dir / MODEL_ID
    if args.verify_only:
        invalid = [spec.name for spec in FILES if not verified(root / spec.name, spec)]
        if invalid:
            parser.exit(1, 'Missing or invalid files: ' + ', '.join(invalid) + '\n')
    else:
        if not shutil.which('curl'):
            parser.error('curl is required; install curl first.')
        print('Preparing %.1f MB; interrupted downloads can be resumed.' % (sum(f.size for f in FILES) / 1e6))
        for spec in FILES:
            download_file(root, spec)
    print('Verified model files: ' + str(root.resolve()))
    print('Serve the browser-models directory through the existing HTTPS site at /majiang/models/.')


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit('Download incomplete. Check network/disk access and rerun; verified files are preserved.')
