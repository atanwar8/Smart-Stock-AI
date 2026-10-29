"""Model registry: id -> forecaster class, plus the weighted ensemble."""

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from ml.models.base import Forecaster, future_index
from ml.models.classical import DampedETS, Naive, SeasonalNaive, Theta
from ml.models.gbm import LightGBMGlobal


class Ensemble(Forecaster):
    """Weighted average of the best members: y_hat = sum_i w_i * y_hat_i, w_i proportional to 1 / MASE_i.

    Members and weights come from the rolling-origin validation on the training weeks (never the hold-out),
    so the ensemble's hold-out score is as honest as every other model's. Members are cheap enough to refit
    on a 512 MB server.
    """
    id, name, family, speed = "ensemble", "Ensemble", "Inverse-MASE weighted combination", "fast"
    blurb = "Blends the three best models on past weeks, weighted by how accurate each one was."

    def __init__(self, weights: Optional[Dict[str, float]] = None, members: Optional[Dict[str, Forecaster]] = None):
        super().__init__()
        self.weights = dict(weights or {"ets": 0.5, "theta": 0.5})
        self.members = members or {}

    def fit(self, y: pd.Series, panel=None, commodity=None) -> "Ensemble":
        self.y = y.astype(float)
        for model_id in self.weights:
            member = self.members.get(model_id) or create(model_id)
            self.members[model_id] = member.fit(y, panel, commodity)
        return self

    def predict(self, h: int, quantiles=()) -> pd.DataFrame:
        total = sum(self.weights.values())
        values = sum(w / total * self.members[m].predict(h)["yhat"].to_numpy() for m, w in self.weights.items())
        return pd.DataFrame({"yhat": values}, index=future_index(self.y.index[-1], h))

    def forecast_origins(self, y, origins, h, panel=None, commodity=None):
        total = sum(self.weights.values())
        points = np.zeros((len(origins), h))
        for model_id, weight in self.weights.items():
            member = self.members.get(model_id) or create(model_id)
            member_points, _ = member.forecast_origins(y, origins, h, panel, commodity)
            points += weight / total * member_points
        return points, None


MODELS = {cls.id: cls for cls in (Naive, SeasonalNaive, DampedETS, Theta, LightGBMGlobal, Ensemble)}
ORDER = ["ensemble", "lightgbm", "ets", "theta", "seasonal_naive", "naive"]
ENSEMBLE_CANDIDATES = ("naive", "seasonal_naive", "ets", "theta", "lightgbm")
ENSEMBLE_SIZE = 3


def create(model_id: str, **kwargs) -> Forecaster:
    if model_id not in MODELS:
        raise KeyError(model_id)
    return MODELS[model_id](**kwargs)


def ensemble_weights(val_mase: Dict[str, float], size: int = ENSEMBLE_SIZE) -> Dict[str, float]:
    """Top `size` candidates by validation MASE, weighted by 1 / MASE (normalized to sum to 1)."""
    ranked = sorted((m for m in val_mase if m in ENSEMBLE_CANDIDATES and np.isfinite(val_mase[m]) and val_mase[m] > 0),
                    key=lambda m: val_mase[m])[:size]
    if not ranked:
        return {"ets": 0.5, "theta": 0.5}
    inverse = {m: 1 / val_mase[m] for m in ranked}
    total = sum(inverse.values())
    return {m: round(v / total, 4) for m, v in inverse.items()}


def catalog() -> List[Forecaster]:
    return [MODELS[m] for m in ORDER]
