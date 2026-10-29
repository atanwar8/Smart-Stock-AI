"""Point and interval accuracy metrics (all on the price scale, dollars per unit)."""

from typing import Dict, Optional

import numpy as np


def mae(actual, predicted) -> float:
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    return float(np.mean(np.abs(actual - predicted)))


def rmse(actual, predicted) -> float:
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    return float(np.sqrt(np.mean((actual - predicted) ** 2)))


def mape(actual, predicted) -> float:
    """Mean absolute percentage error, in percent. Prices are strictly positive, so it is well defined."""
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    return float(100 * np.mean(np.abs(actual - predicted) / np.abs(actual)))


def smape(actual, predicted) -> float:
    """Symmetric MAPE in percent (0-200): 2|y - f| / (|y| + |f|), as in the M3/M4 competitions."""
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    return float(100 * np.mean(2 * np.abs(actual - predicted) / (np.abs(actual) + np.abs(predicted))))


def mase_scale(train, observed: Optional[np.ndarray] = None, m: int = 1) -> float:
    """In-sample MAE of the m-step naive forecast on the training weeks: the MASE denominator.

    m = 1 for weekly data, as in the M4 competition (52.18 weeks/year has no integer season, and two cycles
    of history give too few seasonal differences for a stable scale). Pairs touching an interpolated week
    are skipped.
    """
    train = np.asarray(train, float)
    diffs = np.abs(train[m:] - train[:-m])
    if observed is not None:
        observed = np.asarray(observed, bool)
        diffs = diffs[observed[m:] & observed[:-m]]
    return float(np.mean(diffs)) if len(diffs) else float("nan")


def mase(actual, predicted, scale: float) -> float:
    """MAE divided by the naive in-sample MAE. Below 1 = better than "same as last week" was in training."""
    return mae(actual, predicted) / scale if scale and scale > 0 else float("nan")


def coverage(actual, lo, hi) -> float:
    """Share of actuals inside [lo, hi]."""
    actual, lo, hi = np.asarray(actual, float), np.asarray(lo, float), np.asarray(hi, float)
    return float(np.mean((actual >= lo) & (actual <= hi)))


def skill(model_mae: float, baseline_mae: float) -> float:
    """1 - MAE_model / MAE_baseline: positive = better than the baseline on the same weeks."""
    return 1 - model_mae / baseline_mae if baseline_mae > 0 else float("nan")


def summarize(actual, predicted, scale: float, baseline=None, levels=None, confidence: float = 0.8) -> Dict[str, float]:
    """Every leaderboard metric for one set of (actual, predicted) pairs.

    levels: for each pair, the smallest central interval level that contains the actual (see ml.intervals);
    coverage at `confidence` is the share of pairs with level <= confidence.
    """
    out = {"mae": mae(actual, predicted), "rmse": rmse(actual, predicted), "mape": mape(actual, predicted),
           "smape": smape(actual, predicted), "mase": mase(actual, predicted, scale), "n": int(len(actual))}
    out["coverage"] = float(np.mean(np.asarray(levels) <= confidence + 1e-9)) if levels is not None and len(levels) else None
    out["skill"] = skill(out["mae"], mae(actual, baseline)) if baseline is not None else None
    return out
