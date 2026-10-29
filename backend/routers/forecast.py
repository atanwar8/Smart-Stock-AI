"""Forecast Studio and the Supabase training pipeline (/forecast/*, /pipeline/*).

Owned by the ML pipeline; see docs/handoff/SPEC.md for the API contract.
"""

from fastapi import APIRouter

router = APIRouter(tags=["forecast"])
