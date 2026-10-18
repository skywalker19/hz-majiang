"""Single-process, CPU SenseVoice service. No recordings or transcripts are persisted."""
import asyncio
from contextlib import asynccontextmanager
import io
import logging
import os
from pathlib import Path
import re
import time
import wave

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.getenv("SENSEVOICE_MODEL_DIR", ROOT / "models" / "sensevoice"))
STATIC_DIR = Path(os.getenv("MAHJONG_STATIC_DIR", ROOT.parent / "dist"))
MAX_SECONDS = 15
MAX_BYTES = 512_000
SAMPLE_RATE = 16_000
logger = logging.getLogger("sensevoice")


def load_recognizer():
    import sherpa_onnx

    model = MODEL_DIR / "model.int8.onnx"
    tokens = MODEL_DIR / "tokens.txt"
    if not model.is_file() or not tokens.is_file():
        raise RuntimeError("SenseVoice model is missing; run download_model.py first")
    # One worker, one ONNX thread, no PyTorch/CUDA or extra speaker models.
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model), tokens=str(tokens), num_threads=1,
        use_itn=False, language="zh", debug=False, provider="cpu",
    )


@asynccontextmanager
async def lifespan(app):
    app.state.recognizer = None
    app.state.busy = asyncio.Lock()
    try:
        app.state.recognizer = await run_in_threadpool(load_recognizer)
        logger.info("SenseVoice INT8 ready (CPU, Mandarin, one inference thread)")
    except Exception:
        # Keep the static app/health endpoint available; never substitute fake text.
        logger.exception("SenseVoice failed to load; fix model/runtime and restart")
    yield
    app.state.recognizer = None


app = FastAPI(title="Mahjong SenseVoice", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def no_audio_cache(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
async def health():
    ready = app.state.recognizer is not None
    return JSONResponse({
        "ready": ready, "busy": app.state.busy.locked(), "engine": "sensevoice",
        "language": "zh", "maxSeconds": MAX_SECONDS, "sampleRate": SAMPLE_RATE,
    }, status_code=200 if ready else 503)


async def read_bounded_audio(request):
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "录音过大，请一次只说一条简短口令。")
        chunks.extend(chunk)
    return bytes(chunks)


def decode_wav(payload):
    try:
        with wave.open(io.BytesIO(payload), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
                raise HTTPException(422, "录音格式不正确，请刷新页面后重新收音。")
            frames = audio.getnframes()
            if frames < SAMPLE_RATE // 4 or frames > SAMPLE_RATE * MAX_SECONDS:
                raise HTTPException(422, "请录制 0.25 到 15 秒的简短口令。")
            pcm = audio.readframes(frames)
            if len(pcm) != frames * 2:
                raise HTTPException(422, "录音数据不完整，请重新说一次。")
    except (wave.Error, EOFError, ValueError) as error:
        raise HTTPException(422, "无法读取这段录音，请重新说一次。") from error
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def recognize(recognizer, samples):
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    # SenseVoice tags describe events/emotions; they are never Mahjong commands.
    return re.sub(r"<\|[^|]*\|>", "", stream.result.text).strip()


@app.post("/api/transcribe")
async def transcribe(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "audio/wav":
        raise HTTPException(415, "请使用网页的“说一句”录音后提交。")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError as error:
            raise HTTPException(400, "录音长度无效。") from error
        if size < 0 or size > MAX_BYTES:
            raise HTTPException(413, "录音过大，请一次只说一条简短口令。")
    recognizer = app.state.recognizer
    if recognizer is None:
        raise HTTPException(503, "语音模型尚未就绪，请检查服务状态；仍可使用文字和按钮。")
    # No unbounded queue and no extra model copies on the 2 GB server.
    lock = app.state.busy
    if lock.locked():
        raise HTTPException(429, "语音服务正在处理另一句话，请稍后再试。", headers={"Retry-After": "2"})
    await lock.acquire()
    try:
        try:
            payload = await asyncio.wait_for(read_bounded_audio(request), timeout=10)
        except asyncio.TimeoutError as error:
            raise HTTPException(408, "录音上传超时，请检查网络后重试。") from error
        samples = decode_wav(payload)
        if await request.is_disconnected():
            return JSONResponse({"detail": "录音请求已取消。"}, status_code=499)
        started = time.perf_counter()
        # run_in_threadpool waits for the native call before releasing the lock,
        # including when the browser cancels; there is no concurrent decode.
        text = await run_in_threadpool(recognize, recognizer, samples)
        if not text or len(text) > 160:
            raise HTTPException(422, "没有识别到清晰的短口令，请靠近手机再说一次。")
        return {"text": text, "engine": "sensevoice", "language": "zh",
                "audioSeconds": round(len(samples) / SAMPLE_RATE, 2),
                "inferenceMs": round((time.perf_counter() - started) * 1000)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Recognition request failed")
        raise HTTPException(500, "这次识别没有完成，请重试或使用文字口令。") from None
    finally:
        lock.release()


if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="mahjong")
