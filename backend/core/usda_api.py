"""USDA MyMarketNews (MARS) API client for the weekly National Retail Report - Specialty Crops.

Report 3324 (FVWRETAIL), section "Report Details": one row per report week x commodity x region x
variety x package size, the same data Example_Train.csv was built from.
Docs: https://mymarketnews.ams.usda.gov/mymarketnews-api (free key from My Profile, sent as the
HTTP Basic username with an empty password).
"""

import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Dict, Iterable, List
from urllib.parse import quote

import pandas as pd
import requests

API_BASE = os.getenv('MARS_API_BASE', 'https://marsapi.ams.usda.gov/services/v3.1')
REPORT_ID = 3324
SECTION = 'Report Details'
PAGE_SIZE = 1500    # rows per response; a full page means there may be more
CHUNK_DAYS = 182    # roughly 26 weekly reports per request

# MARS field (lower-cased) -> Example_Train.csv column
FIELDS = {
    'report_end_date': 'report_date',
    'region': 'region',
    'community': 'class',
    'commodity': 'commodity',
    'variety': 'variety',
    'organic': 'organic',
    'size': 'unit',
    'environment': 'environment',
    'store_count': 'current_ad_count',
    'wtd_avg_price': 'current_wtd_avg_price',
    'prior_wk_store_count': 'priorwk_ad_count',
    'prior_wk_wtd_avg_price': 'priorwk_wtd_avg_price',
    'prior_yr_store_count': 'prioryr_ad_count',
    'prior_yr_wtd_avg_price': 'prioryr_wtd_avg_price',
}
COLUMNS = ['report_date', 'region', 'class', 'commodity', 'variety', 'organic', 'unit', 'environment',
           'price_min', 'price_max', 'current_ad_count', 'current_wtd_avg_price', 'priorwk_ad_count',
           'priorwk_wtd_avg_price', 'prioryr_ad_count', 'prioryr_wtd_avg_price']
DEDUP_KEYS = ['report_date', 'region', 'class', 'commodity', 'variety', 'organic', 'unit']
DATE_FORMAT = '%m/%d/%Y'

Getter = Callable[..., requests.Response]


class MissingApiKey(RuntimeError):
    """MARS_API_KEY is not set."""


def fetch_rows(api_key: str, filters: Dict[str, str], start: date, end: date, get: Getter = requests.get) -> List[Dict]:
    """All "Report Details" rows matching the filters, for report weeks starting between start and end."""
    for value in filters.values():
        if ',' in value or ';' in value:
            raise ValueError(f"MARS filter values can't contain ',' or ';': {value!r}")
    query = ';'.join(f"{field}={quote(value, safe='')}" for field, value in filters.items())
    query += f";report_begin_date={start:%m/%d/%Y}:{end:%m/%d/%Y}"
    url = f"{API_BASE}/reports/{REPORT_ID}/{quote(SECTION)}?q={query}"
    response = get(url, auth=(api_key, ''), timeout=60)
    response.raise_for_status()
    rows = response.json().get('results', [])

    if len(rows) >= PAGE_SIZE and end > start:
        middle = start + (end - start) / 2
        return (fetch_rows(api_key, filters, start, middle, get)
                + fetch_rows(api_key, filters, middle + timedelta(days=1), end, get))
    return rows


def fetch_commodity(api_key: str, commodity: str, start: date, end: date, get: Getter = requests.get,
                    unit: str = None, community: str = 'Vegetables') -> List[Dict]:
    """All "Report Details" rows for one commodity with report weeks starting between start and end.

    MARS splits filter values on commas (even when percent-encoded), so a name like "Onions, Green"
    can't be a commodity filter. Those are fetched by class and unit, then narrowed to the commodity.
    """
    if ',' not in commodity:
        return fetch_rows(api_key, {'commodity': commodity}, start, end, get)
    if not unit:
        raise ValueError(f"{commodity!r} needs its unit (e.g. 'per bunch') to be looked up")
    rows = fetch_rows(api_key, {'community': community, 'size': unit}, start, end, get)
    return [row for row in rows if row.get('commodity') == commodity]


def to_frame(rows: Iterable[Dict]) -> pd.DataFrame:
    """MARS rows -> Example_Train.csv columns. Report dates are the Friday each report week ends."""
    records = []
    for row in rows:
        lowered = {k.lower(): v for k, v in row.items()}
        record = {column: lowered.get(field) for field, column in FIELDS.items()}
        low, _, high = str(lowered.get('price_range') or '').partition('-')
        record['price_min'] = pd.to_numeric(low, errors='coerce')
        record['price_max'] = pd.to_numeric(high, errors='coerce')
        records.append(record)
    return pd.DataFrame(records, columns=COLUMNS)


def append_to_training(new_rows: pd.DataFrame, train_path: Path) -> int:
    """Add new rows to the training CSV, replacing stored rows USDA has re-published. Returns rows added."""
    train_path = Path(train_path)
    # Keep USDA's literal "N/A" (variety, environment) as text so stored rows match re-published ones
    existing = (pd.read_csv(train_path, keep_default_na=False, na_values=[''])
                if train_path.exists() else pd.DataFrame(columns=COLUMNS))
    existing = _dedupe(existing)
    if new_rows.empty:
        return 0
    # Stable sort keeps stored rows ahead of fetched ones within a date, so keep='last' prefers the fresh copy
    combined = _dedupe(pd.concat([existing, new_rows], ignore_index=True))
    combined.to_csv(train_path, index=False)
    return len(combined) - len(existing)


def _dedupe(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame['report_date'] = pd.to_datetime(frame['report_date'], format=DATE_FORMAT, errors='coerce')
    frame = frame.dropna(subset=['report_date']).sort_values('report_date', ascending=False, kind='stable')
    frame = frame.drop_duplicates(subset=DEDUP_KEYS, keep='last')
    frame['report_date'] = frame['report_date'].dt.strftime(DATE_FORMAT)
    return frame


def refresh_training_data(train_path, commodities: Iterable[str], api_key: str = None,
                          today: date = None, get: Getter = requests.get) -> Dict:
    """Fetch every report week since the newest one in the training CSV and append it.

    The newest stored week is requested again so corrections USDA published since are picked up.
    """
    api_key = api_key or os.getenv('MARS_API_KEY')
    if not api_key:
        raise MissingApiKey("Set MARS_API_KEY to a free MyMarketNews API key (mymarketnews.ams.usda.gov, My Profile).")

    train_path = Path(train_path)
    existing = pd.read_csv(train_path, usecols=['report_date', 'class', 'commodity', 'unit'])
    newest = pd.to_datetime(existing['report_date'], format=DATE_FORMAT, errors='coerce').max().date()
    start, end = newest - timedelta(days=6), today or date.today()

    rows, empty = [], []
    for commodity in commodities:
        # Class and most common unit, needed to look up names that contain a comma
        stored = existing[existing['commodity'] == commodity]
        hints = {'unit': stored['unit'].mode().iloc[0], 'community': stored['class'].mode().iloc[0]} if len(stored) else {}
        found = []
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS), end)
            found += fetch_commodity(api_key, commodity, chunk_start, chunk_end, get, **hints)
            chunk_start = chunk_end + timedelta(days=1)
        rows += found
        if not found:
            empty.append(commodity)

    added = append_to_training(to_frame(rows), train_path) if rows else 0
    latest = pd.to_datetime(pd.read_csv(train_path, usecols=['report_date'])['report_date'], format=DATE_FORMAT).max()
    return {'rows_added': added, 'latest': latest.date().isoformat(), 'empty_commodities': empty}
