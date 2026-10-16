create table if not exists public.nominatim_geocode_cache (
  cache_key text primary key check (length(cache_key) = 64),
  address text not null,
  fetched_at timestamptz not null default now()
);

alter table public.nominatim_geocode_cache enable row level security;
revoke all on public.nominatim_geocode_cache from anon, authenticated;
grant select, insert, update on public.nominatim_geocode_cache to service_role;

create table if not exists public.nominatim_rate_limit (
  singleton boolean primary key default true check (singleton),
  next_request_at timestamptz not null default now()
);

alter table public.nominatim_rate_limit enable row level security;
revoke all on public.nominatim_rate_limit from anon, authenticated;
grant select, insert, update on public.nominatim_rate_limit to service_role;

create or replace function public.nominatim_reserve_request_slot()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_at timestamptz;
begin
  insert into public.nominatim_rate_limit (singleton, next_request_at)
  values (true, clock_timestamp())
  on conflict (singleton) do nothing;

  update public.nominatim_rate_limit
  set next_request_at = greatest(next_request_at, clock_timestamp()) + interval '1.1 seconds'
  where singleton = true
  returning next_request_at - interval '1.1 seconds' into reserved_at;

  return reserved_at;
end;
$$;

revoke all on function public.nominatim_reserve_request_slot() from public, anon, authenticated;
grant execute on function public.nominatim_reserve_request_slot() to service_role;
