"""Prediction intervals: split-conformal widths per horizon step.

From rolling-origin backtests we have, for each horizon
step h, out-of-sample log errors e = log(actual) - log(forecast). The interval at confidence c is
forecast * exp(+-q_c(h)), where q_c(h) is the ceil((n+1)c)-th smallest |e| among the n errors at step h.
If future errors are exchangeable with past ones, the interval covers with probability >= c (Vovk et al.;
Stankeviciute et al. 2021 for multi-step series). Working in logs makes widths proportional to price.
"""

from typing import List, Optional, Sequence

import numpy as np

from ml.config import MIN_CALIBRATION

LEVELS = np.round(np.arange(0.50, 0.951, 0.05), 2)     # confidence grid the tables are stored on


def conformal_table(abs_errors: Sequence[Sequence[float]], horizon: int) -> np.ndarray:
    """(len(LEVELS), horizon) log half-widths from per-step absolute log errors.

    Steps with fewer than MIN_CALIBRATION errors borrow the last well-estimated step's width, grown like a
    random walk (sqrt(h / h0)). Widths never shrink with h or with confidence.
    """
    table = np.full((len(LEVELS), horizon), np.nan)
    for h in range(horizon):
        errors = np.sort(np.asarray(abs_errors[h] if h < len(abs_errors) else [], float))
        errors = errors[np.isfinite(errors)]
        n = len(errors)
        if n < MIN_CALIBRATION:
            continue
        ranks = np.minimum(np.ceil((n + 1) * LEVELS).astype(int), n) - 1
        table[:, h] = errors[ranks]
    valid = np.where(np.isfinite(table[0]))[0]
    if len(valid) == 0:
        table[:] = 0.15 * np.sqrt(np.arange(1, horizon + 1))[None, :] * (LEVELS[:, None] / 0.8)  # no data: wide prior
    else:
        last = valid[-1]
        for h in range(horizon):
            if not np.isfinite(table[0, h]):
                anchor = last if h > last else valid[0]
                table[:, h] = table[:, anchor] * np.sqrt((h + 1) / (anchor + 1))
    table = np.maximum.accumulate(table, axis=1)
    table = np.maximum.accumulate(table, axis=0)
    return table


def half_width(table, confidence: float, steps: int) -> np.ndarray:
    """Log half-width per step at any confidence in [0.5, 0.95] (linear between stored levels)."""
    table = np.asarray(table, float)
    confidence = float(np.clip(confidence, LEVELS[0], LEVELS[-1]))
    widths = np.array([np.interp(confidence, LEVELS, table[:, h]) for h in range(table.shape[1])])
    if steps > len(widths):   # longer than calibrated: random-walk growth from the last step
        extra = widths[-1] * np.sqrt(np.arange(len(widths) + 1, steps + 1) / len(widths))
        widths = np.concatenate([widths, extra])
    return widths[:steps]


def conformal_level(abs_error: float, column: Sequence[float]) -> float:
    """Smallest stored confidence whose interval contains an error of this size (1.0 = outside 95%)."""
    column = np.asarray(column, float)
    if abs_error <= column[0]:
        return float(LEVELS[0])
    if abs_error > column[-1]:
        return 1.0
    # Ties in the column (flat stretches) map to the lowest level that reaches the error
    idx = int(np.argmax(column >= abs_error))
    lo_w, hi_w = column[idx - 1], column[idx]
    frac = 0 if hi_w == lo_w else (abs_error - lo_w) / (hi_w - lo_w)
    return float(LEVELS[idx - 1] + frac * (LEVELS[idx] - LEVELS[idx - 1]))


def scenario(values: np.ndarray, pace_pct: float) -> np.ndarray:
    """Pace slider: drift linearly to (1 + pace/100) x the model's path by the last step."""
    values = np.asarray(values, float)
    steps = values.shape[-1] if values.ndim else 1
    ramp = 1 + (pace_pct / 100.0) * np.arange(1, steps + 1) / steps
    return values * ramp


def pick(levels: Optional[List[float]], confidence: float) -> Optional[float]:
    if not levels:
        return None
    return float(np.mean(np.asarray(levels) <= confidence + 1e-9))
