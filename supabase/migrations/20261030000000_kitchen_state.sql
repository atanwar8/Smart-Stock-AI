-- The kitchen's own state, so it survives restarts and is the same on every Vercel function instance.
--
-- inventory_items: what the chef logged on Smart ordering, one row per vegetable (days left, status and shelf
--   life are computed when read, never stored). app_settings: small JSON settings, e.g. 'alert_settings'.
-- Like the training store, RLS is on with no policies: only the backend (database owner, via the pooler) reads
-- or writes them; the public anon/publishable key can do neither.

create table public.inventory_items (
  ingredient    text primary key,
  current_stock numeric(12, 3) not null check (current_stock >= 0),
  daily_usage   numeric(12, 3) not null check (daily_usage >= 0),
  max_capacity  numeric(12, 3) not null check (max_capacity >= 0),
  unit          text not null default 'lbs',
  updated_at    timestamptz not null default now()
);

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;
alter table public.app_settings    enable row level security;
