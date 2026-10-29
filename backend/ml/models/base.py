"""One interface for every forecaster: fit(series) -> self, predict(h, quantiles) -> frame.

Models see a regular weekly price series (pd.Series on a 7-day grid). Backtests call forecast_origins(),
which by default refits on y[:origin + 1] for every origin, so a model can never see a week after its
forecast origin. Models with a cheaper exact equivalent (batched TimesFM, a global LightGBM refit on a
schedule) override it, and the no-look-ahead tests cover those overrides too.
"""

from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

WEEK = pd.Timedelta(days=7)


def future_index(last: pd.Timestamp, steps: int) -> pd.DatetimeIndex:
    return pd.date_range(last + WEEK, periods=steps, freq="7D")


class Forecaster:
    id = "base"
    name = "Base"
    family = ""
    speed = "fast"
    blurb = ""
    native_quantiles = False   # True: predict() returns its own deciles (q0.1 .. q0.9)
    uses_panel = False         # True: fit() also learns from the other commodities (cross-learning)

    def __init__(self):
        self.y: Optional[pd.Series] = None
        self.commodity: Optional[str] = None

    # --- the public interface --------------------------------------------------------------------
    def fit(self, y: pd.Series, panel: Optional[Dict] = None, commodity: Optional[str] = None) -> "Forecaster":
        self.y = y.astype(float)
        self.commodity = commodity
        self._fit(np.asarray(self.y, float), panel)
        return self

    def predict(self, h: int, quantiles: Sequence[float] = ()) -> pd.DataFrame:
        values = np.asarray(self._predict(h), float)
        frame = pd.DataFrame({"yhat": values}, index=future_index(self.y.index[-1], h))
        return frame

    # --- backtests ----------------------------------------------------------------------------------
    def forecast_origins(self, y: pd.Series, origins: List[int], h: int, panel: Optional[Dict] = None,
                         commodity: Optional[str] = None):
        """Point forecasts (len(origins), h) made at each origin from y[:origin + 1] only.

        Returns (points, deciles-or-None).
        """
        points = np.full((len(origins), h), np.nan)
        for row, origin in enumerate(origins):
            history = y.iloc[:origin + 1]
            self.fit(history, panel, commodity)
            points[row] = self.predict(h)["yhat"].to_numpy()
        return points, None

    # --- to implement -------------------------------------------------------------------------------
    def _fit(self, values: np.ndarray, panel: Optional[Dict]) -> None:
        raise NotImplementedError

    def _predict(self, h: int) -> np.ndarray:
        raise NotImplementedError
