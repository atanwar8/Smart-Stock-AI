"""SQLAlchemy Core tables mirroring supabase/migrations/20261028000000_training_store.sql.

On Supabase the migration is the source of truth (the tables already exist, create_all is a no-op).
The same definitions create an identical local SQLite store, so every query is written once.
"""

from sqlalchemy import (JSON, BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, MetaData,
                        Numeric, String, Table, Text, UniqueConstraint)
from sqlalchemy.dialects import postgresql

metadata = MetaData()

# BIGINT identity on Postgres, INTEGER PRIMARY KEY (rowid alias, autoincrements) on SQLite
BigId = BigInteger().with_variant(Integer, "sqlite")
Json = JSON().with_variant(postgresql.JSONB(), "postgresql")
Uuid = String(36).with_variant(postgresql.UUID(as_uuid=False), "postgresql")
# asdecimal=False: callers get floats, never Decimal, from both backends
Money = Numeric(10, 2, asdecimal=False)

ingest_runs = Table(
    "ingest_runs", metadata,
    Column("id", BigId, primary_key=True, autoincrement=True),
    Column("started_at", DateTime(timezone=True), nullable=False),
    Column("finished_at", DateTime(timezone=True)),
    Column("source", Text, nullable=False),
    Column("window_start", Date),
    Column("window_end", Date),
    Column("rows_fetched", Integer, nullable=False, default=0),
    Column("rows_inserted", Integer, nullable=False, default=0),
    Column("rows_updated", Integer, nullable=False, default=0),
    Column("status", Text, nullable=False, default="running"),
    Column("error", Text),
)

usda_prices = Table(
    "usda_prices", metadata,
    Column("id", BigId, primary_key=True, autoincrement=True),
    Column("report_date", Date, nullable=False),
    Column("region", Text, nullable=False, default="Midwest"),
    Column("class", Text, nullable=False, default="Vegetables"),
    Column("commodity", Text, nullable=False),
    Column("variety", Text, nullable=False, default="N/A"),
    Column("organic", Text, nullable=False, default="No"),
    Column("unit", Text, nullable=False),
    Column("environment", Text),
    Column("price_min", Money),
    Column("price_max", Money),
    Column("current_ad_count", Integer),
    Column("current_wtd_avg_price", Money),
    Column("priorwk_ad_count", Integer),
    Column("priorwk_wtd_avg_price", Money),
    Column("prioryr_ad_count", Integer),
    Column("prioryr_wtd_avg_price", Money),
    Column("ingest_run_id", BigId, ForeignKey("ingest_runs.id")),
    Column("inserted_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("report_date", "region", "class", "commodity", "variety", "organic", "unit",
                     name="usda_prices_natural_key"),
)
Index("usda_prices_series_idx", usda_prices.c.commodity, usda_prices.c.unit, usda_prices.c.report_date.desc())
Index("usda_prices_report_date_idx", usda_prices.c.report_date.desc())
Index("usda_prices_ingest_run_idx", usda_prices.c.ingest_run_id)

training_runs = Table(
    "training_runs", metadata,
    Column("id", BigId, primary_key=True, autoincrement=True),
    Column("ingest_run_id", BigId, ForeignKey("ingest_runs.id")),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("commodity", Text, nullable=False),
    Column("unit", Text, nullable=False),
    Column("model", Text, nullable=False),
    Column("train_start", Date),
    Column("train_end", Date),
    Column("test_start", Date),
    Column("test_end", Date),
    Column("n_train", Integer),
    Column("n_test", Integer),
    Column("metrics", Json, nullable=False, default=dict),
    Column("params", Json, nullable=False, default=dict),
    Column("is_champion", Boolean, nullable=False, default=False),
)
Index("training_runs_leaderboard_idx", training_runs.c.commodity, training_runs.c.created_at.desc())
Index("training_runs_ingest_run_idx", training_runs.c.ingest_run_id)

forecasts = Table(
    "forecasts", metadata,
    Column("id", Uuid, primary_key=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("commodity", Text, nullable=False),
    Column("unit", Text, nullable=False),
    Column("model", Text, nullable=False),
    Column("horizon_weeks", Integer, nullable=False),
    Column("confidence", Numeric(4, 3, asdecimal=False), nullable=False),
    Column("history_years", Numeric(4, 1, asdecimal=False)),
    Column("pace_pct", Numeric(5, 1, asdecimal=False), nullable=False, default=0),
    Column("status", Text, nullable=False, default="preview"),
    Column("applied_at", DateTime(timezone=True)),
    Column("training_run_id", BigId, ForeignKey("training_runs.id")),
    Column("points", Json, nullable=False),
    Column("metrics", Json, nullable=False, default=dict),
    Column("summary", Text),
)
Index("forecasts_commodity_status_idx", forecasts.c.commodity, forecasts.c.status, forecasts.c.applied_at.desc())
Index("forecasts_training_run_idx", forecasts.c.training_run_id)
# At most one applied forecast per commodity (partial unique index on both backends)
Index("forecasts_one_applied_per_commodity", forecasts.c.commodity, unique=True,
      sqlite_where=forecasts.c.status == "applied", postgresql_where=forecasts.c.status == "applied")

NATURAL_KEY = ("report_date", "region", "class", "commodity", "variety", "organic", "unit")
PRICE_VALUES = ("environment", "price_min", "price_max", "current_ad_count", "current_wtd_avg_price",
                "priorwk_ad_count", "priorwk_wtd_avg_price", "prioryr_ad_count", "prioryr_wtd_avg_price")
