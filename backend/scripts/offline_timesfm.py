"""Score TimesFM 2.5 on every tracked vegetable and store its backtest + 26-week forecast in the training store.

Why offline: TimesFM-2.5-200M needs ~1 GB of RAM and torch, more than the free Render instance has. Run this on a
machine that can load it (e.g. your laptop with backend/.venv-ml), pointed at the same store the server uses; the
server then serves TimesFM in "stored" mode (ml.service.model_status) from what this writes.

    cd backend
    python3.12 -m venv .venv-ml && .venv-ml/bin/pip install -r requirements.txt "timesfm[torch]>=2.0"
    SUPABASE_DB_URL=... .venv-ml/bin/python -m scripts.offline_timesfm            # every tracked vegetable
    SUPABASE_DB_URL=... .venv-ml/bin/python -m scripts.offline_timesfm Tomatoes   # just one

Writes, per vegetable: one training_runs row (model 'timesfm', params.source 'offline', same rolling-origin
backtest and hold-out as the pipeline) and one forecasts row linked to it holding 26 weekly points with deciles.
Nothing existing is changed or deleted.
"""

import os
import sys
import time

os.environ["ENABLE_TIMESFM"] = "1"   # this script exists to run TimesFM in-process

from ml.backtest import evaluate  # noqa: E402
from ml.config import MAX_HORIZON, SERIES_REGION  # noqa: E402
from ml.models.timesfm_model import TimesFM  # noqa: E402
from ml.series import build_panel  # noqa: E402
from store import get_store  # noqa: E402


def main(only=None) -> int:
    live, reason = TimesFM.live_status()
    if not live:
        print(f"TimesFM can't run here: {reason}")
        return 1
    store = get_store()
    print(f"Store: {store.summary()}")
    panel = build_panel(store.read_prices(region=SERIES_REGION))
    names = [n for n in sorted(panel) if not only or n in only]
    model = TimesFM()
    started = time.time()
    TimesFM.load()
    print(f"Loaded TimesFM in {time.time() - started:.0f} s")
    for name in names:
        series = panel[name]
        t0 = time.time()
        ev = evaluate(series, ["timesfm"], panel=panel, models={"timesfm": model})["timesfm"]
        run = ev.training_run(source="offline", history_years=None)
        run_id = store.write_training_runs([run])[0]
        frame = model.fit(series.y, panel, name).predict(MAX_HORIZON)
        quantiles = sorted(c for c in frame.columns if c.startswith("q"))
        points = [{"date": d.date().isoformat(), "yhat": round(float(r["yhat"]), 4),
                   "deciles": [round(float(r[q]), 4) for q in quantiles]} for d, r in frame.iterrows()]
        store.insert_forecast({"commodity": name, "unit": series.unit, "model": "timesfm", "horizon_weeks": MAX_HORIZON,
                               "confidence": 0.8, "history_years": None, "status": "preview",
                               "training_run_id": run_id, "points": points, "metrics": ev.metrics,
                               "summary": f"Offline TimesFM forecast for {name}."})
        m = ev.metrics
        print(f"{name:22s} MASE {m.get('mase', float('nan')):.3f}  skill {m.get('skill') or 0:+.3f}  "
              f"coverage {m.get('coverage') or 0:.2f}  ({time.time() - t0:.0f} s)")
    print(f"Done: {len(names)} vegetables in {time.time() - started:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main(set(sys.argv[1:]) or None))
