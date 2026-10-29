"""Seed an empty training store with the last N years of the bundled USDA export (Example_Train.csv)."""

import os
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
SEED_YEARS = 2


def default_csv_path() -> Path:
    data_dir = Path(os.getenv("DATA_DIR", PROJECT_DIR))
    return Path(os.getenv("TRAIN_DATA_PATH", data_dir / "Example_Train.csv"))


def read_seed_rows(csv_path: Path, years: float = SEED_YEARS) -> pd.DataFrame:
    """Rows whose report week falls in the last `years` years of the file (e.g. 2023-07-28 .. 2025-07-25)."""
    # USDA's literal "N/A" (variety, environment) stays text so it matches re-published rows on the natural key
    frame = pd.read_csv(csv_path, keep_default_na=False, na_values=[""])
    dates = pd.to_datetime(frame["report_date"], format="%m/%d/%Y", errors="coerce")
    cutoff = dates.max() - pd.DateOffset(months=int(round(years * 12)))
    return frame[dates > cutoff].reset_index(drop=True)


def seed_if_empty(store, csv_path: Optional[Path] = None, years: float = SEED_YEARS) -> Dict:
    """Load the seed window as one 'seed:csv' ingest run. A no-op when the store already has price rows."""
    with store.exclusive("smartstock:seed") as got:
        if not got:
            return {"seeded": False, "reason": "another process is seeding"}
        if store.price_count() > 0:
            return {"seeded": False, "reason": "store already has rows", **store.summary()}
        csv_path = Path(csv_path or default_csv_path())
        if not csv_path.exists():
            return {"seeded": False, "reason": f"{csv_path} not found"}
        rows = read_seed_rows(csv_path, years)
        dates = pd.to_datetime(rows["report_date"], format="%m/%d/%Y")
        run_id = store.start_ingest_run("seed:csv", dates.min().date(), dates.max().date())
        try:
            inserted, updated = store.upsert_prices(rows, run_id)
        except Exception as exc:
            store.finish_ingest_run(run_id, "failed", rows_fetched=len(rows), error=str(exc)[:500])
            raise
        store.finish_ingest_run(run_id, "succeeded", rows_fetched=len(rows), rows_inserted=inserted, rows_updated=updated)
        return {"seeded": True, "ingest_run_id": run_id, "rows": len(rows), "inserted": inserted,
                "first_date": dates.min().date().isoformat(), "last_date": dates.max().date().isoformat()}
