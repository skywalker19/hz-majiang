FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt \
    && useradd --uid 10001 --create-home voice
COPY app.py download_model.py ./
ENV SENSEVOICE_MODEL_DIR=/models MAHJONG_STATIC_DIR=/static
USER voice
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1", "--limit-concurrency", "8", "--timeout-keep-alive", "5"]
