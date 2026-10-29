"""TimesFM 2.5 (google/timesfm-2.5-200m-pytorch) adapter, imported lazily.

TimesFM is a decoder-only transformer pre-trained on ~100B real and synthetic time points. It reads the
history in patches of 32 points, forecasts in output patches, and has a quantile head, so it forecasts any
series zero-shot (no per-commodity training) with its own q10..q90.

It needs Python >= 3.10, torch and ~1 GB of RAM, so it runs in-process only when ENABLE_TIMESFM=1 and the
import works (backend/.venv-ml locally). Everywhere else the API serves the latest stored offline run
(scripts/offline_timesfm.py) - see ml.service.
"""

import importlib.util
import os
import threading
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from ml.config import timesfm_enabled
from ml.models.base import Forecaster, future_index

REPO_ID = os.getenv("TIMESFM_REPO", "google/timesfm-2.5-200m-pytorch")
MAX_CONTEXT = 1024    # 20 years of weekly data; longer histories keep the newest 1024 weeks
MAX_HORIZON = 128


class TimesFM(Forecaster):
    id, name, family, speed = "timesfm", "TimesFM 2.5", "Foundation model (Google, zero-shot)", "slow"
    blurb = "Pre-trained on 100B+ real time points; forecasts without per-item training."
    native_quantiles = True

    _model = None
    _load_error: Optional[str] = None
    _lock = threading.Lock()

    @classmethod
    def installed(cls) -> bool:
        return importlib.util.find_spec("timesfm") is not None and importlib.util.find_spec("torch") is not None

    @classmethod
    def live_status(cls) -> Tuple[bool, Optional[str]]:
        """(can run in this process, reason if not). Does not load the weights."""
        if not timesfm_enabled():
            return False, "ENABLE_TIMESFM is not 1 on this server (TimesFM needs ~1 GB RAM)."
        if not cls.installed():
            return False, "The timesfm and torch packages are not installed in this Python environment."
        if cls._load_error:
            return False, cls._load_error
        return True, None

    @classmethod
    def load(cls):
        with cls._lock:
            if cls._model is None:
                try:
                    import timesfm
                    import torch
                    torch.set_float32_matmul_precision("high")
                    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(REPO_ID, torch_compile=False)
                    model.compile(timesfm.ForecastConfig(
                        max_context=MAX_CONTEXT, max_horizon=MAX_HORIZON, normalize_inputs=True,
                        use_continuous_quantile_head=True, force_flip_invariance=True, infer_is_positive=True,
                        fix_quantile_crossing=True, per_core_batch_size=64))
                    cls._model = model
                except Exception as exc:  # keep the reason for /forecast/models
                    cls._load_error = f"TimesFM failed to load: {exc}"[:300]
                    raise
        return cls._model

    def _raw(self, contexts: Sequence[np.ndarray], h: int) -> Tuple[np.ndarray, np.ndarray]:
        """(points (n, h), deciles (n, h, 9)). The quantile head returns [mean, q10, ..., q90]."""
        model = self.load()
        with self._lock:
            points, quantiles = model.forecast(horizon=h, inputs=[np.asarray(c, float) for c in contexts])
        return np.asarray(points)[:, :h], np.asarray(quantiles)[:, :h, 1:10]

    def _fit(self, values, panel):
        self.values = values

    def predict(self, h: int, quantiles=()) -> pd.DataFrame:
        points, deciles = self._raw([self.values], h)
        frame = pd.DataFrame({"yhat": points[0]}, index=future_index(self.y.index[-1], h))
        for i, q in enumerate(np.round(np.arange(0.1, 0.91, 0.1), 1)):
            frame[f"q{q:.1f}"] = deciles[0, :, i]
        return frame

    def forecast_origins(self, y: pd.Series, origins: List[int], h: int, panel: Optional[Dict] = None,
                         commodity: Optional[str] = None):
        # One batched call: each context is the history up to its origin, nothing later
        contexts = [y.to_numpy(float)[:origin + 1] for origin in origins]
        points, deciles = self._raw(contexts, h)
        return points, deciles
