"""Download only the pinned INT8 SenseVoice model, tokens and license. Python stdlib only."""
import argparse
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL_NAME}.tar.bz2"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "models" / "sensevoice")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print("Downloading the official INT8 archive. Allow space for the archive and ~228 MB model.")
    # Stream to disk. Never load the model archive into RAM or extract arbitrary paths.
    with tempfile.TemporaryDirectory(dir=args.output_dir) as temporary:
        archive = Path(temporary) / "model.tar.bz2"
        with urllib.request.urlopen(MODEL_URL, timeout=120) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        with tarfile.open(archive, mode="r:bz2") as bundle:
            for filename in ("model.int8.onnx", "tokens.txt", "LICENSE"):
                member = bundle.getmember(f"{MODEL_NAME}/{filename}")
                if not member.isfile() or member.size > 400 * 1024 * 1024:
                    raise RuntimeError(f"Unexpected archive entry: {filename}")
                pending = Path(temporary) / filename
                with bundle.extractfile(member) as source, pending.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                pending.replace(args.output_dir / filename)
    print(f"Model ready in {args.output_dir.resolve()}. Restart the voice service after downloading.")


if __name__ == "__main__":
    main()
