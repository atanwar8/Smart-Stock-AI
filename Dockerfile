# SmartStock AI: one container serves the dashboard and the forecasting API on $PORT.

# 1) Build the Next.js dashboard as static files (smartstock-nextjs/out)
FROM node:26-alpine AS ui
WORKDIR /ui
COPY smartstock-nextjs/package.json smartstock-nextjs/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY smartstock-nextjs/ ./
RUN npm run build

# 2) FastAPI backend, which also serves the built dashboard at "/"
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_PATH=/usr/bin/chromedriver \
    HEADLESS=1

# libgomp1: LightGBM/XGBoost runtime. chromium + driver: the "Data refresh" USDA scraper.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY *.py *.csv ./
COPY --from=ui /ui/out smartstock-nextjs/out

WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
