-- =========================================================
-- Carnet de maison — schéma Supabase (v2 : plusieurs foyers)
-- À exécuter dans Supabase > SQL Editor > New query > Run.
--
-- • Installation neuve : crée tout.
-- • Mise à jour depuis la v1 : rattache automatiquement les données
--   existantes à un foyer « Mon foyer » dont les membres sont les
--   adresses de l'ancienne table "members". Rien n'est supprimé.
-- • Le script peut être relancé sans risque.
--
-- Principe : chaque plante / tâche / article appartient à un foyer.
-- Une personne ne voit que les foyers dont elle est membre. Le filtrage
-- est fait par la base (RLS), pas par l'application.
-- =========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Foyers et membres ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_idx on public.household_members(user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- L'utilisateur connecté est-il membre de ce foyer ?
create or replace function public.is_household_member(h uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = h and user_id = auth.uid());
$$;

-- Code d'invitation : 6 caractères sans ambiguïté (pas de O/0, I/1), tirés au hasard cryptographique.
create or replace function public.new_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  b bytea;
begin
  loop
    b := extensions.gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end $$;

-- Créer un foyer (l'appelant en devient propriétaire)
create or replace function public.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  insert into public.households (name, invite_code, created_by)
    values (left(trim(p_name), 60), public.new_invite_code(), auth.uid())
    returning id into h;
  insert into public.household_members (household_id, user_id, role) values (h, auth.uid(), 'owner');
  return h;
end $$;

-- Rejoindre un foyer avec son code
create or replace function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into h from public.households where invite_code = upper(replace(trim(p_code), ' ', ''));
  if h is null then raise exception 'invalid_code'; end if;
  insert into public.household_members (household_id, user_id) values (h, auth.uid()) on conflict do nothing;
  return h;
end $$;

-- Quitter un foyer (le dernier membre qui part supprime le foyer et ses données)
create or replace function public.leave_household(h uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.household_members where household_id = h and user_id = auth.uid();
  if not exists (select 1 from public.household_members where household_id = h) then
    delete from public.households where id = h;
  end if;
end $$;

-- Générer un nouveau code (l'ancien cesse de fonctionner)
create or replace function public.regenerate_invite(h uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_household_member(h) then raise exception 'forbidden'; end if;
  code := public.new_invite_code();
  update public.households set invite_code = code where id = h;
  return code;
end $$;

-- Liste des membres d'un foyer (adresses e-mail), visible uniquement par ses membres
create or replace function public.household_member_list(h uuid)
returns table (email text, role text, is_me boolean)
language sql stable security definer set search_path = public as $$
  select u.email::text, m.role, m.user_id = auth.uid()
  from public.household_members m join auth.users u on u.id = m.user_id
  where m.household_id = h and public.is_household_member(h)
  order by m.joined_at;
$$;

revoke all on function public.is_household_member(uuid), public.new_invite_code(), public.create_household(text),
  public.join_household(text), public.leave_household(uuid), public.regenerate_invite(uuid),
  public.household_member_list(uuid) from public, anon;
grant execute on function public.is_household_member(uuid), public.create_household(text), public.join_household(text),
  public.leave_household(uuid), public.regenerate_invite(uuid), public.household_member_list(uuid) to authenticated;

drop policy if exists "foyers: lecture" on public.households;
create policy "foyers: lecture" on public.households
  for select to authenticated using (public.is_household_member(id));
drop policy if exists "foyers: renommer" on public.households;
create policy "foyers: renommer" on public.households
  for update to authenticated using (public.is_household_member(id)) with check (public.is_household_member(id));

drop policy if exists "membres du foyer: lecture" on public.household_members;
create policy "membres du foyer: lecture" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

-- ---------- Données de l'app (une ligne = un document JSON rattaché à un foyer) ----------
do $$
declare t text;
begin
  foreach t in array array['plants', 'tasks', 'groceries'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now(),
        updated_by text default (auth.jwt() ->> 'email')
      );
      alter table public.%1$I add column if not exists household_id uuid references public.households(id) on delete cascade;
      create index if not exists %1$s_household_idx on public.%1$I(household_id);
      alter table public.%1$I enable row level security;

      -- anciennes règles (v1, foyer unique)
      drop policy if exists "membres: lecture" on public.%1$I;
      drop policy if exists "membres: ajout" on public.%1$I;
      drop policy if exists "membres: modification" on public.%1$I;
      drop policy if exists "membres: suppression" on public.%1$I;

      drop policy if exists "foyer: lecture" on public.%1$I;
      create policy "foyer: lecture" on public.%1$I
        for select to authenticated using (public.is_household_member(household_id));
      drop policy if exists "foyer: ajout" on public.%1$I;
      create policy "foyer: ajout" on public.%1$I
        for insert to authenticated with check (public.is_household_member(household_id));
      drop policy if exists "foyer: modification" on public.%1$I;
      create policy "foyer: modification" on public.%1$I
        for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
      drop policy if exists "foyer: suppression" on public.%1$I;
      create policy "foyer: suppression" on public.%1$I
        for delete to authenticated using (public.is_household_member(household_id));
    $f$, t);
  end loop;
end $$;

create or replace function public.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  return new;
end $$;
drop trigger if exists plants_touch on public.plants;
create trigger plants_touch before update on public.plants for each row execute function public.touch_updated();
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated();
drop trigger if exists groceries_touch on public.groceries;
create trigger groceries_touch before update on public.groceries for each row execute function public.touch_updated();

do $$
begin
  begin alter publication supabase_realtime add table public.plants;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tasks;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.groceries; exception when duplicate_object then null; end;
end $$;

-- ---------- Abonnements aux notifications (par personne) ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.push_subscriptions alter column user_id set default auth.uid();
do $$ begin
  -- colonne de la v1, devenue inutile
  alter table public.push_subscriptions alter column email drop not null;
exception when undefined_column then null; end $$;
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: gérer ses abonnements" on public.push_subscriptions;
drop policy if exists "push: mes appareils" on public.push_subscriptions;
create policy "push: mes appareils" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Quota d'identification des plantes (par foyer et par jour) ----------
create table if not exists public.identify_usage (
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (household_id, day)
);
alter table public.identify_usage enable row level security;  -- aucune règle : accès uniquement via la fonction

create or replace function public.consume_identify_quota(h uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  daily_limit constant int := 25;   -- identifications par foyer et par jour
  n int;
begin
  if not public.is_household_member(h) then return false; end if;
  insert into public.identify_usage (household_id, day, count)
    values (h, (now() at time zone 'Europe/Paris')::date, 1)
    on conflict (household_id, day) do update set count = public.identify_usage.count + 1
    returning count into n;
  return n <= daily_limit;
end $$;
revoke all on function public.consume_identify_quota(uuid) from public, anon;
grant execute on function public.consume_identify_quota(uuid) to authenticated;

-- ---------- Migration depuis la v1 (foyer unique) ----------
do $$
declare h uuid;
begin
  if to_regclass('public.members') is not null
     and not exists (select 1 from public.households)
     and exists (select 1 from public.members m join auth.users u on lower(u.email) = lower(m.email)) then
    insert into public.households (name, invite_code) values ('Mon foyer', public.new_invite_code()) returning id into h;
    insert into public.household_members (household_id, user_id, role)
      select h, u.id, 'owner' from public.members m join auth.users u on lower(u.email) = lower(m.email)
      on conflict do nothing;
    update public.plants    set household_id = h where household_id is null;
    update public.tasks     set household_id = h where household_id is null;
    update public.groceries set household_id = h where household_id is null;
    update public.push_subscriptions p set user_id = u.id
      from auth.users u where p.user_id is null and p.email is not null and lower(u.email) = lower(p.email);
    raise notice 'Données existantes rattachées au foyer « Mon foyer » (%)', h;
  end if;
exception when undefined_column then
  -- installation neuve : push_subscriptions n'a pas de colonne email, rien à migrer
  null;
end $$;

-- L'ancienne fonction v1 n'est plus utilisée
drop function if exists public.is_member();
