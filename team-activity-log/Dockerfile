# One image: the React app built in live mode, served by the FastAPI backend (same origin, so
# session cookies stay first-party). Build context: this directory (team-activity-log/).

# ---- frontend ----
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_API_MODE=live
RUN npx vite build

# ---- backend ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# Tesseract: the built-in engine that reads text in images (tal.ocr). English only by default;
# add packs like tesseract-ocr-deu and set OCR_LANGUAGES=eng+deu for more.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/pyproject.toml backend/README.md ./
COPY backend/src ./src
RUN pip install . && rm -rf src
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV ENV=production FRONTEND_DIST=/app/frontend/dist
RUN useradd --create-home app
USER app
# Railway sets PORT (8080 by default); the public domain must target the same port.
EXPOSE 8080
# Migrations are idempotent, so running them on every start is safe.
CMD ["sh", "-c", "tal migrate && tal serve --port ${PORT:-8080}"]
