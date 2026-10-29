-- SmartStock AI training store.
--
-- usda_prices is append-only: every refresh adds only the weeks since the newest stored report and
-- upserts corrections to that newest week, so nothing the models already learned from is ever lost.
-- The backend connects as the database owner through Supabase's pooler, so RLS is on with no
-- policies: the public anon/publishable key can read or write nothing.

create table public.ingest_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  source        text not null,                       -- 'seed:csv' | 'usda:mymarketnews'
  window_start  date,                                -- first report week requested
  window_end    date,                                -- last report week requested
  rows_fetched  integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated  integer not null default 0,
  status        text not null default 'running'
                check (status in ('running', 'succeeded', 'failed', 'skipped')),
  error         text
);

create table public.usda_prices (
  id                    bigint generated always as identity primary key,
  report_date           date not null,
  region                text not null default 'Midwest',
  class                 text not null default 'Vegetables',
  commodity             text not null,
  variety               text not null default 'N/A',
  organic               text not null default 'No',
  unit                  text not null,
  environment           text,
  price_min             numeric(10, 2),
  price_max             numeric(10, 2),
  current_ad_count      integer,
  current_wtd_avg_price numeric(10, 2),
  priorwk_ad_count      integer,
  priorwk_wtd_avg_price numeric(10, 2),
  prioryr_ad_count      integer,
  prioryr_wtd_avg_price numeric(10, 2),
  ingest_run_id         bigint references public.ingest_runs (id),
  inserted_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint usda_prices_natural_key
    unique (report_date, region, class, commodity, variety, organic, unit)
);

-- The models read one commodity's series in one unit, newest first
create index usda_prices_series_idx on public.usda_prices (commodity, unit, report_date desc);
-- "What is the newest week we have?" drives the incremental extract
create index usda_prices_report_date_idx on public.usda_prices (report_date desc);
create index usda_prices_ingest_run_idx on public.usda_prices (ingest_run_id);

create table public.training_runs (
  id            bigint generated always as identity primary key,
  ingest_run_id bigint references public.ingest_runs (id),
  created_at    timestamptz not null default now(),
  commodity     text not null,
  unit          text not null,
  model         text not null,                       -- 'seasonal_naive' | 'ets' | 'theta' | 'lightgbm' | 'timesfm' | 'ensemble' ...
  train_start   date,
  train_end     date,
  test_start    date,
  test_end      date,
  n_train       integer,
  n_test        integer,
  metrics       jsonb not null default '{}'::jsonb,  -- mae, rmse, mape, smape, mase, coverage, skill
  params        jsonb not null default '{}'::jsonb,
  is_champion   boolean not null default false
);

create index training_runs_leaderboard_idx on public.training_runs (commodity, created_at desc);
create index training_runs_ingest_run_idx on public.training_runs (ingest_run_id);

create table public.forecasts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  commodity       text not null,
  unit            text not null,
  model           text not null,
  horizon_weeks   integer not null check (horizon_weeks between 1 and 52),
  confidence      numeric(4, 3) not null check (confidence > 0 and confidence < 1),
  history_years   numeric(4, 1),                     -- null = every stored week
  pace_pct        numeric(5, 1) not null default 0,  -- scenario nudge applied on top of the model
  status          text not null default 'preview'
                  check (status in ('preview', 'applied', 'superseded')),
  applied_at      timestamptz,
  training_run_id bigint references public.training_runs (id),
  points          jsonb not null,                    -- [{date, yhat, lo, hi}], stored whole to avoid N+1 reads
  metrics         jsonb not null default '{}'::jsonb,
  summary         text
);

create index forecasts_commodity_status_idx on public.forecasts (commodity, status, applied_at desc);
create index forecasts_training_run_idx on public.forecasts (training_run_id);
-- At most one applied forecast per commodity: applying a new one supersedes the old one
create unique index forecasts_one_applied_per_commodity on public.forecasts (commodity) where status = 'applied';

alter table public.ingest_runs   enable row level security;
alter table public.usda_prices   enable row level security;
alter table public.training_runs enable row level security;
alter table public.forecasts     enable row level security;
