"""Vercel entry point for the SmartStock API.

On Vercel the dashboard (smartstock-nextjs/out) is served as static files from the CDN, and every request to
/api/... is rewritten to this one Python function (vercel.json). It only puts backend/ on the import path and
exposes the FastAPI app unchanged, so the routes are exactly the ones that run locally; main.StripApiPrefix
removes the /api prefix.

Vercel sets VERCEL=1, which switches the backend to its serverless behaviour: nothing trains at startup or in
background threads, pages read the forecasts the pipeline stored in Supabase, and a refresh (only when someone
clicks Data refresh) runs inside its own request. The database is Supabase Postgres, named
by SUPABASE_DB_URL in the Vercel project's environment variables (never committed). Locally, run the API with
uvicorn from backend/ instead (./start.sh).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from main import app  # noqa: E402,F401  (Vercel serves the ASGI `app`)
