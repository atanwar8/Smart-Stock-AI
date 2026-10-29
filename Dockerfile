# SmartStock AI: one container serves the dashboard and the forecasting API on $PORT.

# 1) Build the Next.js dashboard as static files (smartstock-nextjs/out)
FROM node:22-alpine AS ui
WORKDIR /ui
COPY smartstock-nextjs/package.json smartstock-nextjs/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY smartstock-nextjs/ ./
RUN npm run build

# 2) FastAPI backend, which also serves the built dashboard at "/"
FROM python:3.11-slim
# WEB_CONCURRENCY = uvicorn worker processes. Keep 1 while inventory and alerts live in process memory
# (each worker would hold its own copy); see the README's scaling notes before raising it.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WEB_CONCURRENCY=1

# libgomp1: the OpenMP runtime LightGBM needs
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
# Only the data files the app reads (training prices, commodity names, shelf lives)
COPY Example_Train.csv usda_commodity.csv ingredient_storage_data.csv ./
COPY --from=ui /ui/out smartstock-nextjs/out

WORKDIR /app/backend
EXPOSE 8000
# For `docker run` / compose; Render probes /health itself (render.yaml)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"
# exec: uvicorn is PID 1 and gets the platform's shutdown signal. --forwarded-allow-ips: trust the platform
# proxy's X-Forwarded-Proto, so redirects (e.g. /path -> /path/) stay on https
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'"]
