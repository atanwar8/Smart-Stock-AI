"""Raw USDA rows -> one regular weekly price series per tracked commodity.

The export repeats each week once per variety and package size, so rows are not a time series. Same rule
as /commodities: keep the commodity's most common unit, average its rows per report week. Missing weeks are
filled by linear interpolation so models see a regular grid, but they are flagged and never scored.
"""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from ml.config import MIN_WEEKS

PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
FALLBACK_TRACKED = ["Asparagus", "Broccoli", "Cabbage", "Carrots", "Cauliflower", "Cucumbers", "Lettuce",
                    "Onions, Green", "Peppers, Bell Type", "Sweet Potatoes", "Tomatoes"]
WEEK = pd.Timedelta(days=7)


@dataclass
class WeeklySeries:
    commodity: str
    unit: str
    y: pd.Series                      # regular weekly grid, float, gaps interpolated
    observed: np.ndarray              # True where the week had a real report
    extra: Dict = field(default_factory=dict)

    @property
    def dates(self) -> pd.DatetimeIndex:
        return self.y.index

    def __len__(self) -> int:
        return len(self.y)

    def last_years(self, years: Optional[float]) -> "WeeklySeries":
        """The newest `years` years (None = everything stored)."""
        if not years:
            return self
        cutoff = self.y.index[-1] - pd.DateOffset(months=int(round(years * 12)))
        keep = self.y.index > cutoff
        return WeeklySeries(self.commodity, self.unit, self.y[keep], self.observed[keep], self.extra)

    def until(self, last_date: pd.Timestamp) -> "WeeklySeries":
        keep = self.y.index <= last_date
        return WeeklySeries(self.commodity, self.unit, self.y[keep], self.observed[keep], self.extra)


def _key(name: str) -> str:
    return re.sub(r"[^a-z]", "", str(name).lower())


def tracked_names() -> List[str]:
    """The vegetables the app tracks (usda_commodity.csv, like /commodities)."""
    data_dir = Path(os.getenv("DATA_DIR", PROJECT_DIR))
    path = data_dir / "usda_commodity.csv"
    try:
        return [n.strip() for n in pd.read_csv(path)["usda_commodity"].dropna().astype(str)]
    except Exception:
        return list(FALLBACK_TRACKED)


def tracked_commodities(stored: Iterable[str]) -> List[str]:
    """Stored commodity names that match a tracked name, ignoring punctuation.

    usda_commodity.csv says "Peppers, Bell Type" while USDA rows say "Peppers (Bell Type)"; both mean the same
    vegetable, so matching on letters keeps it in the model set. Returned names are the stored spelling.
    """
    wanted = {_key(n) for n in tracked_names()}
    return sorted({name for name in stored if _key(name) in wanted})


def weekly_series(rows: pd.DataFrame, commodity: str) -> Optional[WeeklySeries]:
    """rows: report_date / commodity / unit / price (one region). None if the commodity has too little data."""
    rows = rows[rows["commodity"] == commodity]
    if rows.empty:
        return None
    unit = rows["unit"].mode().iloc[0]
    prices = rows[rows["unit"] == unit].groupby("report_date")["price"].mean().sort_index()
    prices = prices[prices > 0].dropna()
    if len(prices) < MIN_WEEKS:
        return None
    grid = pd.date_range(prices.index[0], prices.index[-1], freq="7D")
    # Report weeks are Fridays; snap any odd date to the nearest grid week before reindexing
    snapped = prices.copy()
    snapped.index = grid[np.clip(np.round((prices.index - grid[0]) / WEEK).astype(int), 0, len(grid) - 1)]
    snapped = snapped.groupby(level=0).mean()
    y = snapped.reindex(grid)
    observed = y.notna().to_numpy()
    y = y.interpolate(method="linear").bfill().ffill().astype(float).rename("price")
    return WeeklySeries(commodity, str(unit), y, observed)


def build_panel(rows: pd.DataFrame, commodities: Optional[Iterable[str]] = None) -> Dict[str, WeeklySeries]:
    """{commodity: WeeklySeries} for every tracked commodity with enough history."""
    names = list(commodities) if commodities is not None else tracked_commodities(rows["commodity"].unique())
    panel = {}
    for name in names:
        series = weekly_series(rows, name)
        if series is not None:
            panel[name] = series
    return panel


def truncate_panel(panel: Dict[str, WeeklySeries], last_date: pd.Timestamp,
                   years: Optional[float] = None) -> Dict[str, WeeklySeries]:
    """Every series cut at last_date (and optionally to the last `years` before it): no look-ahead for global models."""
    out = {}
    for name, series in panel.items():
        cut = series.until(last_date)
        if years:
            cut = cut.last_years(years)
        if len(cut) >= 8:
            out[name] = cut
    return out
