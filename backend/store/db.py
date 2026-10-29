"""Training store: Supabase Postgres when SUPABASE_DB_URL is set, else a local SQLite file.

One class, one set of SQLAlchemy Core queries for both backends. Every read the models need is a single
indexed query (no per-commodity loops), and every write that must be consistent runs in one transaction.
"""

import json
import math
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
from sqlalchemy import and_, create_engine, event, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine, make_url

from store.schema import NATURAL_KEY, PRICE_VALUES, forecasts, ingest_runs, metadata, training_runs, usda_prices

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Vercel's filesystem is read-only except /tmp (only used there if SUPABASE_DB_URL is missing)
DEFAULT_SQLITE_PATH = Path("/tmp/smartstock.db") if os.getenv("VERCEL") else BACKEND_DIR / "var" / "smartstock.db"
VERSION_TTL_SECONDS = 30   # other workers' writes become visible to this worker's caches within this window

INT_COLUMNS = ("current_ad_count", "priorwk_ad_count", "prioryr_ad_count")
MONEY_COLUMNS = ("price_min", "price_max", "current_wtd_avg_price", "priorwk_wtd_avg_price", "prioryr_wtd_avg_price")
KEY_DEFAULTS = {"region": "Midwest", "class": "Vegetables", "variety": "N/A", "organic": "No"}


class NotFound(LookupError):
    """No row with that id."""


class Conflict(RuntimeError):
    """The row is in a state that forbids the change (e.g. applying a superseded forecast)."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_ts(value) -> Optional[str]:
    """Timestamps as ISO-8601 UTC with a Z (SQLite hands back naive datetimes that were stored as UTC)."""
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_date(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value[:10]
    return value.isoformat()[:10]


def jsonable(value):
    """numpy/pandas scalars -> plain Python, NaN/inf -> None, so JSON columns serialize on both backends."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, (np.floating, float)):
        value = float(value)
        return value if math.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()   # series dates are report weeks
    if isinstance(value, datetime):
        return iso_ts(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def make_engine(url: Optional[str] = None, sqlite_path: Optional[Path] = None) -> Tuple[Engine, str]:
    """Pooled Postgres engine for a Supabase URL, else a SQLite engine. Returns (engine, 'supabase'|'local')."""
    if url:
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url[len(prefix):]
        parsed = make_url(url)
        serverless = bool(os.getenv("VERCEL"))
        if serverless and (parsed.host or "").endswith("pooler.supabase.com") and parsed.port in (None, 5432):
            # Session mode gives every client its own server connection (15 in all on Supabase's free plan), and
            # many short-lived function instances, plus any other host still connected, use them up
            # ("EMAXCONNSESSION max clients reached"). The transaction pooler on 6543, same host and password,
            # lends a server connection per transaction instead. The refresh lock is transaction-scoped
            # (exclusive), so it works there too.
            parsed = parsed.set(port=6543)
        connect_args = {"connect_timeout": 10}
        if "sslmode" not in parsed.query:
            connect_args["sslmode"] = "require"
        if parsed.port == 6543:
            # Supavisor's transaction pooler can't keep server-side prepared statements between transactions
            connect_args["prepare_threshold"] = None
        # A function instance serves few requests at a time and Supavisor does the real pooling: keep a small pool
        pool = {"pool_size": 2, "max_overflow": 3} if serverless else {"pool_size": 5, "max_overflow": 5}
        engine = create_engine(parsed, pool_pre_ping=True, pool_recycle=300, connect_args=connect_args, **pool)
        return engine, "supabase"

    path = Path(sqlite_path or os.getenv("SMARTSTOCK_DB_PATH") or DEFAULT_SQLITE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")   # readers don't block the pipeline's writes
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine, "local"


def _clean_price_rows(frame: pd.DataFrame) -> List[Dict]:
    """USDA/CSV rows -> dicts with the store's types, one per natural key (the last copy wins)."""
    if frame is None or frame.empty:
        return []
    frame = frame.copy()
    raw_dates = frame["report_date"]
    dates = pd.to_datetime(raw_dates, format="%m/%d/%Y", errors="coerce")
    if dates.isna().any():
        dates = dates.fillna(pd.to_datetime(raw_dates, errors="coerce"))
    frame["report_date"] = dates.dt.date
    frame = frame.dropna(subset=["report_date", "commodity", "unit"])
    for column, default in KEY_DEFAULTS.items():
        if column not in frame:
            frame[column] = default
        frame[column] = frame[column].where(frame[column].notna() & (frame[column].astype(str).str.strip() != ""), default)
        frame[column] = frame[column].astype(str)
    frame = frame.drop_duplicates(subset=list(NATURAL_KEY), keep="last")

    rows = []
    for record in frame.to_dict("records"):
        row = {key: record[key] for key in NATURAL_KEY}
        row["commodity"], row["unit"] = str(row["commodity"]), str(row["unit"])
        env = record.get("environment")
        row["environment"] = None if env is None or (isinstance(env, float) and math.isnan(env)) else str(env)
        for column in MONEY_COLUMNS:
            value = pd.to_numeric(record.get(column), errors="coerce")
            row[column] = None if value is None or pd.isna(value) else round(float(value), 2)
        for column in INT_COLUMNS:
            value = pd.to_numeric(record.get(column), errors="coerce")
            row[column] = None if value is None or pd.isna(value) else int(round(float(value)))
        rows.append(row)
    return rows


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) or isinstance(b, float):
        return abs(float(a) - float(b)) < 0.005
    return a == b


class Store:
    """All reads and writes of the training store."""

    def __init__(self, engine: Engine, backend: str):
        self.engine = engine
        self.backend = backend
        self._version: Tuple[float, Optional[str]] = (0.0, None)
        self._applied: Optional[str] = None
        self._local_lock = threading.Lock()

    @property
    def is_postgres(self) -> bool:
        return self.engine.dialect.name == "postgresql"

    def create_tables(self) -> None:
        """Create missing tables (SQLite; on Supabase the migration already created them, so this is a no-op)."""
        metadata.create_all(self.engine, checkfirst=True)

    # ------------------------------------------------------------------ data version (cache key)

    def data_version(self) -> str:
        """Changes whenever prices or training runs change. Cached briefly so hot endpoints don't query it."""
        stamp, value = self._version
        if value is not None and time.monotonic() - stamp < VERSION_TTL_SECONDS:
            return value
        with self.engine.connect() as conn:
            prices = conn.execute(select(func.count(), func.max(usda_prices.c.report_date),
                                         func.max(usda_prices.c.updated_at))).one()
            runs = conn.execute(select(func.max(training_runs.c.id))).scalar()
            applied = conn.execute(select(func.max(forecasts.c.applied_at))).scalar()
        value = f"{prices[0]}:{iso_date(prices[1])}:{prices[2]}:{runs}"
        self._applied = str(applied)
        self._version = (time.monotonic(), value)
        return value

    def applied_version(self) -> Optional[str]:
        """Changes whenever a forecast is applied (read with data_version, same 30 s cache). Kept out of
        data_version so applying doesn't empty the studio's caches."""
        self.data_version()
        return self._applied

    def bump_version(self) -> None:
        self._version = (0.0, None)

    # ------------------------------------------------------------------ prices

    def price_count(self) -> int:
        with self.engine.connect() as conn:
            return int(conn.execute(select(func.count()).select_from(usda_prices)).scalar() or 0)

    def latest_report_date(self) -> Optional[date]:
        with self.engine.connect() as conn:
            value = conn.execute(select(func.max(usda_prices.c.report_date))).scalar()
        return date.fromisoformat(iso_date(value)) if value else None

    def summary(self) -> Dict:
        with self.engine.connect() as conn:
            row = conn.execute(select(func.count(), func.min(usda_prices.c.report_date),
                                      func.max(usda_prices.c.report_date),
                                      func.count(func.distinct(usda_prices.c.commodity)))).one()
        return {"backend": self.backend, "rows": int(row[0] or 0), "first_date": iso_date(row[1]),
                "last_date": iso_date(row[2]), "commodities": int(row[3] or 0)}

    def unit_hints(self) -> Dict[str, Dict[str, str]]:
        """Most common unit and class per commodity (one grouped query), for USDA lookups of comma names."""
        query = (select(usda_prices.c.commodity, usda_prices.c.unit, usda_prices.c["class"], func.count().label("n"))
                 .group_by(usda_prices.c.commodity, usda_prices.c.unit, usda_prices.c["class"]))
        with self.engine.connect() as conn:
            rows = conn.execute(query).all()
        hints: Dict[str, Tuple[int, Dict[str, str]]] = {}
        for commodity, unit, klass, n in sorted(rows, key=lambda r: (r[0], -r[3], r[1])):
            if commodity not in hints:
                hints[commodity] = (n, {"unit": unit, "community": klass})
        return {commodity: value for commodity, (_, value) in hints.items()}

    def upsert_prices(self, frame: pd.DataFrame, ingest_run_id: Optional[int]) -> Tuple[int, int]:
        """Insert new rows and overwrite re-published ones on the natural key; never deletes.

        Returns (inserted, updated). Rows identical to what is stored count as neither, so re-running the
        same extract is a no-op.
        """
        rows = _clean_price_rows(frame)
        if not rows:
            return 0, 0
        first, last = min(r["report_date"] for r in rows), max(r["report_date"] for r in rows)
        columns = [usda_prices.c[c] for c in NATURAL_KEY + PRICE_VALUES]
        with self.engine.begin() as conn:
            stored = {}
            for record in conn.execute(select(*columns).where(usda_prices.c.report_date.between(first, last))).mappings():
                key = tuple(iso_date(record[k]) if k == "report_date" else record[k] for k in NATURAL_KEY)
                stored[key] = record
            new, changed = [], []
            for row in rows:
                key = tuple(iso_date(row[k]) if k == "report_date" else row[k] for k in NATURAL_KEY)
                if key not in stored:
                    new.append(row)
                elif not all(_same(stored[key][c], row[c]) for c in PRICE_VALUES):
                    changed.append(row)
            now = utcnow()
            payload = [dict(r, ingest_run_id=ingest_run_id, inserted_at=now, updated_at=now) for r in new + changed]
            if payload:
                dialect_insert = pg_insert if self.is_postgres else sqlite_insert
                statement = dialect_insert(usda_prices)
                statement = statement.on_conflict_do_update(
                    index_elements=list(NATURAL_KEY),
                    set_={**{c: statement.excluded[c] for c in PRICE_VALUES},
                          "ingest_run_id": statement.excluded.ingest_run_id, "updated_at": statement.excluded.updated_at})
                for start in range(0, len(payload), 1000):
                    conn.execute(statement, payload[start:start + 1000])
        self.bump_version()
        return len(new), len(changed)

    def read_prices(self, region: Optional[str] = None, commodities: Optional[Iterable[str]] = None) -> pd.DataFrame:
        """report_date / region / commodity / unit / price for every stored row, in one query."""
        query = select(usda_prices.c.report_date, usda_prices.c.region, usda_prices.c.commodity, usda_prices.c.unit,
                       usda_prices.c.current_wtd_avg_price.label("price")).where(
            usda_prices.c.current_wtd_avg_price.isnot(None))
        if region:
            query = query.where(usda_prices.c.region == region)
        if commodities is not None:
            query = query.where(usda_prices.c.commodity.in_(list(commodities)))
        with self.engine.connect() as conn:
            frame = pd.DataFrame(conn.execute(query).all(), columns=["report_date", "region", "commodity", "unit", "price"])
        frame["report_date"] = pd.to_datetime(frame["report_date"])
        frame["price"] = frame["price"].astype(float)
        return frame

    def read_series_rows(self, commodity: str, region: Optional[str] = None) -> pd.DataFrame:
        """One commodity's rows (uses usda_prices_series_idx)."""
        return self.read_prices(region=region, commodities=[commodity])

    def read_rows(self, region: Optional[str] = None) -> pd.DataFrame:
        """Every stored row (of one region) with the USDA export's columns, in one query: the dashboard's price
        history (main.py), so its charts and the Forecast Studio read the same weeks."""
        cols = [c for c in usda_prices.c if c.name not in ("id", "ingest_run_id", "inserted_at", "updated_at")]
        query = select(*cols)
        if region:
            query = query.where(usda_prices.c.region == region)
        with self.engine.connect() as conn:
            frame = pd.DataFrame(conn.execute(query).all(), columns=[c.name for c in cols])
        frame["report_date"] = pd.to_datetime(frame["report_date"])
        numeric = [c.name for c in cols if c.name.startswith(("price_", "current_", "priorwk_", "prioryr_"))]
        for name in numeric:  # Postgres numerics arrive as Decimal
            frame[name] = pd.to_numeric(frame[name], errors="coerce").astype(float)
        return frame

    # ------------------------------------------------------------------ ingest runs

    def start_ingest_run(self, source: str, window_start: Optional[date] = None, window_end: Optional[date] = None) -> int:
        with self.engine.begin() as conn:
            result = conn.execute(insert(ingest_runs).values(
                started_at=utcnow(), source=source, window_start=window_start, window_end=window_end,
                rows_fetched=0, rows_inserted=0, rows_updated=0, status="running").returning(ingest_runs.c.id))
            return int(result.scalar())

    def finish_ingest_run(self, run_id: int, status: str, rows_fetched: int = 0, rows_inserted: int = 0,
                          rows_updated: int = 0, error: Optional[str] = None, window_start: Optional[date] = None,
                          window_end: Optional[date] = None) -> None:
        values = dict(finished_at=utcnow(), status=status, rows_fetched=int(rows_fetched),
                      rows_inserted=int(rows_inserted), rows_updated=int(rows_updated), error=error)
        if window_start is not None:
            values["window_start"] = window_start
        if window_end is not None:
            values["window_end"] = window_end
        with self.engine.begin() as conn:
            conn.execute(update(ingest_runs).where(ingest_runs.c.id == run_id).values(**values))

    @staticmethod
    def _run_dict(row) -> Dict:
        return {"id": int(row["id"]), "source": row["source"], "started_at": iso_ts(row["started_at"]),
                "finished_at": iso_ts(row["finished_at"]), "window_start": iso_date(row["window_start"]),
                "window_end": iso_date(row["window_end"]), "rows_fetched": int(row["rows_fetched"] or 0),
                "rows_inserted": int(row["rows_inserted"] or 0), "rows_updated": int(row["rows_updated"] or 0),
                "status": row["status"], "error": row["error"]}

    def list_ingest_runs(self, limit: int = 20, offset: int = 0) -> Tuple[List[Dict], int]:
        with self.engine.connect() as conn:
            total = int(conn.execute(select(func.count()).select_from(ingest_runs)).scalar() or 0)
            rows = conn.execute(select(ingest_runs).order_by(ingest_runs.c.id.desc()).limit(limit).offset(offset)).mappings().all()
        return [self._run_dict(r) for r in rows], total

    def last_ingest_run(self) -> Optional[Dict]:
        items, _ = self.list_ingest_runs(limit=1)
        return items[0] if items else None

    def latest_successful_ingest_id(self) -> Optional[int]:
        with self.engine.connect() as conn:
            value = conn.execute(select(func.max(ingest_runs.c.id)).where(
                ingest_runs.c.status.in_(("succeeded", "skipped")))).scalar()
        return int(value) if value is not None else None

    def fail_stale_runs(self, older_than: timedelta = timedelta(hours=1)) -> int:
        """Runs left 'running' by a crashed process are marked failed so the status page doesn't hang."""
        cutoff = utcnow() - older_than
        with self.engine.begin() as conn:
            result = conn.execute(update(ingest_runs).where(and_(ingest_runs.c.status == "running",
                                                                 ingest_runs.c.started_at < cutoff))
                                  .values(status="failed", finished_at=utcnow(), error="interrupted (server restarted)"))
            return result.rowcount or 0

    # ------------------------------------------------------------------ training runs

    def write_training_runs(self, rows: List[Dict]) -> List[int]:
        """Bulk insert one evaluation batch (one row per commodity x model)."""
        if not rows:
            return []
        now = utcnow()
        payload = []
        for row in rows:
            record = {k: row.get(k) for k in ("ingest_run_id", "commodity", "unit", "model", "train_start", "train_end",
                                              "test_start", "test_end", "n_train", "n_test")}
            for k in ("train_start", "train_end", "test_start", "test_end"):
                if isinstance(record[k], str):
                    record[k] = date.fromisoformat(record[k])
            record.update(created_at=row.get("created_at") or now, metrics=jsonable(row.get("metrics") or {}),
                          params=jsonable(row.get("params") or {}), is_champion=bool(row.get("is_champion")))
            payload.append(record)
        with self.engine.begin() as conn:
            # executemany + RETURNING ("insertmanyvalues"): one round trip per 1000 rows, ids in input order
            result = conn.execute(insert(training_runs).returning(training_runs.c.id, sort_by_parameter_order=True), payload)
            ids = [int(i) for i in result.scalars().all()]
        self.bump_version()
        return ids

    @staticmethod
    def _training_dict(row) -> Dict:
        return {"id": int(row["id"]), "ingest_run_id": row["ingest_run_id"], "created_at": iso_ts(row["created_at"]),
                "commodity": row["commodity"], "unit": row["unit"], "model": row["model"],
                "train_start": iso_date(row["train_start"]), "train_end": iso_date(row["train_end"]),
                "test_start": iso_date(row["test_start"]), "test_end": iso_date(row["test_end"]),
                "n_train": row["n_train"], "n_test": row["n_test"], "metrics": _load_json(row["metrics"]),
                "params": _load_json(row["params"]), "is_champion": bool(row["is_champion"])}

    def latest_training_runs(self, commodity: Optional[str] = None, scan: int = 400) -> Dict[str, Dict[str, Dict]]:
        """{commodity: {model: newest training run}} from one query (newest rows first, via the leaderboard index)."""
        query = select(training_runs).order_by(training_runs.c.created_at.desc(), training_runs.c.id.desc())
        if commodity is not None:
            query = query.where(training_runs.c.commodity == commodity).limit(scan)
        else:
            # Newest batch per commodity is enough: bound the scan to the last few hundred rows per commodity
            query = query.limit(scan * 12)
        with self.engine.connect() as conn:
            rows = conn.execute(query).mappings().all()
        latest: Dict[str, Dict[str, Dict]] = {}
        for row in rows:
            per_model = latest.setdefault(row["commodity"], {})
            if row["model"] not in per_model:
                per_model[row["model"]] = self._training_dict(row)
        return latest

    def has_training_runs(self) -> bool:
        with self.engine.connect() as conn:
            return conn.execute(select(training_runs.c.id).limit(1)).first() is not None

    # ------------------------------------------------------------------ forecasts

    def insert_forecast(self, row: Dict) -> str:
        forecast_id = row.get("id") or str(uuid.uuid4())
        record = {
            "id": forecast_id, "created_at": row.get("created_at") or utcnow(), "commodity": row["commodity"],
            "unit": row["unit"], "model": row["model"], "horizon_weeks": int(row["horizon_weeks"]),
            "confidence": float(row["confidence"]), "history_years": row.get("history_years"),
            "pace_pct": float(row.get("pace_pct") or 0), "status": row.get("status", "preview"),
            "applied_at": row.get("applied_at"), "training_run_id": row.get("training_run_id"),
            "points": jsonable(row["points"]), "metrics": jsonable(row.get("metrics") or {}), "summary": row.get("summary"),
        }
        with self.engine.begin() as conn:
            conn.execute(insert(forecasts).values(**record))
        return forecast_id

    @staticmethod
    def _forecast_dict(row) -> Dict:
        return {"id": str(row["id"]), "created_at": iso_ts(row["created_at"]), "commodity": row["commodity"],
                "unit": row["unit"], "model": row["model"], "horizon_weeks": int(row["horizon_weeks"]),
                "confidence": float(row["confidence"]),
                "history_years": None if row["history_years"] is None else float(row["history_years"]),
                "pace_pct": float(row["pace_pct"] or 0), "status": row["status"], "applied_at": iso_ts(row["applied_at"]),
                "training_run_id": row["training_run_id"], "points": _load_json(row["points"]),
                "metrics": _load_json(row["metrics"]), "summary": row["summary"]}

    def get_forecast(self, forecast_id: str) -> Optional[Dict]:
        if not _valid_uuid(forecast_id):
            return None
        with self.engine.connect() as conn:
            row = conn.execute(select(forecasts).where(forecasts.c.id == forecast_id)).mappings().first()
        return self._forecast_dict(row) if row else None

    def apply_forecast(self, forecast_id: str) -> Dict:
        """Mark a preview applied and supersede the commodity's previous applied forecast, atomically.

        The partial unique index allows one applied row per commodity, so the old one is superseded first.
        Raises NotFound (unknown id) or Conflict (already superseded).
        """
        if not _valid_uuid(forecast_id):
            raise NotFound(forecast_id)
        with self.engine.begin() as conn:
            query = select(forecasts).where(forecasts.c.id == forecast_id)
            if self.is_postgres:
                query = query.with_for_update()
            row = conn.execute(query).mappings().first()
            if row is None:
                raise NotFound(forecast_id)
            if row["status"] == "superseded":
                raise Conflict("This preview was superseded by a newer applied forecast.")
            if row["status"] == "applied":
                return {"forecast_id": str(row["id"]), "commodity": row["commodity"],
                        "applied_at": iso_ts(row["applied_at"]), "superseded": None}
            previous = conn.execute(select(forecasts.c.id).where(and_(forecasts.c.commodity == row["commodity"],
                                                                      forecasts.c.status == "applied"))).scalars().all()
            if previous:
                conn.execute(update(forecasts).where(forecasts.c.id.in_(previous)).values(status="superseded"))
            now = utcnow()
            conn.execute(update(forecasts).where(forecasts.c.id == forecast_id).values(status="applied", applied_at=now))
        self.bump_version()  # the dashboard re-reads applied forecasts on its next request (main.sync_price_history)
        return {"forecast_id": str(forecast_id), "commodity": row["commodity"], "applied_at": iso_ts(now),
                "superseded": str(previous[0]) if previous else None}

    def active_forecasts(self, commodity: Optional[str] = None) -> List[Dict]:
        query = select(forecasts).where(forecasts.c.status == "applied").order_by(forecasts.c.commodity)
        if commodity:
            query = query.where(forecasts.c.commodity == commodity)
        with self.engine.connect() as conn:
            return [self._forecast_dict(r) for r in conn.execute(query).mappings().all()]

    def prune_previews(self, older_than: timedelta = timedelta(days=7)) -> int:
        """Drop never-applied slider previews after a week (rows linked to a training run are kept)."""
        from sqlalchemy import delete
        cutoff = utcnow() - older_than
        with self.engine.begin() as conn:
            result = conn.execute(delete(forecasts).where(and_(forecasts.c.status == "preview",
                                                               forecasts.c.training_run_id.is_(None),
                                                               forecasts.c.created_at < cutoff)))
            return result.rowcount or 0

    # ------------------------------------------------------------------ locking

    @contextmanager
    def exclusive(self, name: str):
        """Cross-process "one at a time" guard. Yields True if this caller got the lock.

        Postgres: a transaction-scoped advisory lock, which is safe through Supavisor in either pool mode
        (the server connection stays pinned for the open transaction). SQLite: a process-local lock.
        """
        if not self.is_postgres:
            got = self._local_lock.acquire(blocking=False)
            try:
                yield got
            finally:
                if got:
                    self._local_lock.release()
            return
        conn = self.engine.connect()
        transaction = conn.begin()
        try:
            got = bool(conn.execute(text("select pg_try_advisory_xact_lock(hashtext(:name))"), {"name": name}).scalar())
            yield got
        finally:
            try:
                transaction.rollback()
            finally:
                conn.close()


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _load_json(value):
    if isinstance(value, str):
        return json.loads(value)
    return value if value is not None else {}
