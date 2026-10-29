"""Forecasting settings shared by the pipeline, the API and the tests (env-overridable)."""

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


TEST_WEEKS = _int("TEST_WEEKS", 8)          # newest weeks held out for the leaderboard
MAX_HORIZON = 26                            # longest forecast the API serves (and the residuals we calibrate)
SEASON = 52                                 # weeks per seasonal cycle
MIN_CONTEXT = 52                            # first backtest origin needs a full year (seasonal naive, last-year features)
MIN_WEEKS = 30                              # a commodity with fewer stored weeks is not modelled at all
MIN_CALIBRATION = 8                         # residuals needed before a horizon step gets its own interval width
DEFAULT_CONFIDENCE = 0.8
# The bundled history is the Midwest retail report; new USDA pulls bring every region, so the modelled series is
# pinned to one region to keep it comparable over time (all regions are still stored).
SERIES_REGION = os.getenv("SERIES_REGION", "Midwest")

