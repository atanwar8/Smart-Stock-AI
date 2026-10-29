"""Forecast Studio and the training pipeline (/forecast/*, /pipeline/*), per docs/handoff/SPEC.md §5.

Thin HTTP layer: validation and status codes here, all logic in ml.service (forecasts) and ml.pipeline (refresh).
Handlers that fit models are plain `def`, so FastAPI runs them in its thread pool and /health stays responsive.
"""

import os
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ml import pipeline, service

router = APIRouter(tags=["forecast"])


class PreviewRequest(BaseModel):
    commodity: str
    model: str = service.DEFAULT_MODEL
    horizon_weeks: int = Field(1, ge=1, le=8)          # weeks ahead: next week by default, two months at most
    confidence: float = Field(0.8, ge=0.5, le=0.95)
    pace_pct: float = Field(0, ge=-40, le=60)
    # Models always learn from every stored week; a history_years sent by older clients is ignored


class ApplyRequest(BaseModel):
    preview_id: str


def _answer(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except service.StudioError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)


@router.on_event("startup")
def _prepare_store():
    """Seed/train in the background: a cold Supabase or SQLite store must never delay the server answering."""
    if os.getenv("PIPELINE_ON_STARTUP", "1") != "1":
        return

    def run():
        try:
            print(f"🗄️ Training store ready: {pipeline.prepare_store()}")
        except Exception as exc:  # the rest of the API works without the store
            print(f"⚠️ Training store setup failed: {exc}")

    threading.Thread(target=run, name="store-prepare", daemon=True).start()


# ------------------------------------------------------------------------------------------- forecast


@router.get("/forecast/models")
def forecast_models():
    return _answer(service.catalog)


@router.get("/forecast/leaderboard")
def forecast_leaderboard(commodity: str = Query(..., min_length=1)):
    return _answer(service.leaderboard, commodity)


@router.post("/forecast/preview")
def forecast_preview(request: PreviewRequest):
    return _answer(service.preview, request.commodity, request.model, request.horizon_weeks, request.confidence,
                   request.pace_pct)


@router.post("/forecast/apply")
def forecast_apply(request: ApplyRequest):
    return _answer(service.apply, request.preview_id)


@router.get("/forecast/active")
def forecast_active(commodity: Optional[str] = None):
    return _answer(service.active, commodity)


# ------------------------------------------------------------------------------------------- pipeline


@router.post("/pipeline/refresh", status_code=202)
def pipeline_refresh():
    try:
        return pipeline.start()
    except pipeline.Busy as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/pipeline/status")
def pipeline_status():
    return pipeline.status()


@router.get("/pipeline/runs")
def pipeline_runs(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    return pipeline.runs(limit, offset)
