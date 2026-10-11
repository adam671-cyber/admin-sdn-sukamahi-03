drop policy if exists "profiles_select_kepsek" on public.profiles;
create policy "profiles_select_kepsek" on public.profiles for select to authenticated
using (public.is_kepsek());