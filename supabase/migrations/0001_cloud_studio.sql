-- ---------------------------------------------------------------------------
-- Cloud mode: what the studio keeps on the server.
--
-- Three tables, one shape. Every row is owned by an `owner` string, which is
-- either `user:<auth uid>` for a signed-in visitor or `device:<hash>` for the
-- anonymous browser cookie the app mints on first use. Keeping both in one
-- column means a project saved before signing in can be adopted afterwards by
-- rewriting a single field.
--
-- Row level security is on everywhere and only ever grants access to rows whose
-- `user_id` matches the caller. The API routes run with the secret key, which
-- bypasses RLS, and enforce ownership themselves - so a device-owned row is
-- reachable only by a request carrying that signed cookie.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Saved workspaces: one row per project, per studio.
create table if not exists public.studio_projects (
  id          uuid primary key default gen_random_uuid(),
  owner       text not null,
  user_id     uuid references auth.users (id) on delete cascade,
  studio      text not null check (studio in ('video','captions','silence','tools','editor','resume')),
  name        text not null default 'Untitled',
  -- the studio's own session snapshot, exactly as the local vault stores it
  data        jsonb not null default '{}'::jsonb,
  -- schema version of `data`, so an old snapshot is rejected rather than misread
  version     integer not null default 1,
  poster_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Media living in Cloudinary. The bytes are there; this is the index over them.
create table if not exists public.studio_assets (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null,
  user_id        uuid references auth.users (id) on delete cascade,
  project_id     uuid references public.studio_projects (id) on delete set null,
  provider       text not null default 'cloudinary',
  public_id      text not null,
  resource_type  text not null default 'video' check (resource_type in ('video','image','raw')),
  kind           text not null default 'source' check (kind in ('source','output','overlay','subtitle','poster')),
  format         text,
  bytes          bigint,
  duration       double precision,
  width          integer,
  height         integer,
  secure_url     text not null,
  original_name  text,
  created_at     timestamptz not null default now()
);

-- Work handed to the server: a Cloudinary transformation, or a Remotion render.
create table if not exists public.studio_jobs (
  id                uuid primary key default gen_random_uuid(),
  owner             text not null,
  user_id           uuid references auth.users (id) on delete cascade,
  project_id        uuid references public.studio_projects (id) on delete set null,
  kind              text not null check (kind in ('transform','render','transcode')),
  status            text not null default 'queued' check (status in ('queued','running','ready','failed')),
  label             text,
  tool              text,
  params            jsonb not null default '{}'::jsonb,
  source_public_id  text,
  transformation    text,
  progress          real not null default 0,
  result            jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists studio_projects_owner_idx on public.studio_projects (owner, updated_at desc);
create index if not exists studio_projects_user_idx  on public.studio_projects (user_id, updated_at desc);
create index if not exists studio_assets_owner_idx   on public.studio_assets (owner, created_at desc);
create index if not exists studio_assets_public_idx  on public.studio_assets (public_id);
create index if not exists studio_jobs_owner_idx     on public.studio_jobs (owner, created_at desc);

-- `updated_at` that is actually true, rather than whatever the caller sent.
create or replace function public.studio_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists studio_projects_touch on public.studio_projects;
create trigger studio_projects_touch
  before update on public.studio_projects
  for each row execute function public.studio_touch_updated_at();

drop trigger if exists studio_jobs_touch on public.studio_jobs;
create trigger studio_jobs_touch
  before update on public.studio_jobs
  for each row execute function public.studio_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- The publishable key can reach these tables directly from a browser, so the
-- default has to be "nothing". A signed-in visitor sees only rows stamped with
-- their own uid; anonymous device rows have a null user_id and so match no
-- policy at all - they are reachable only through the server routes.
-- ---------------------------------------------------------------------------

alter table public.studio_projects enable row level security;
alter table public.studio_assets   enable row level security;
alter table public.studio_jobs     enable row level security;

drop policy if exists studio_projects_own on public.studio_projects;
create policy studio_projects_own on public.studio_projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists studio_assets_own on public.studio_assets;
create policy studio_assets_own on public.studio_assets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists studio_jobs_own on public.studio_jobs;
create policy studio_jobs_own on public.studio_jobs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
