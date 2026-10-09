-- =========================================================
-- Carnet de maison — schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor > New query.
-- Modèle : un seul foyer. Toute personne listée dans "members"
-- voit et modifie toutes les données ; les autres comptes ne voient rien.
-- =========================================================

-- ---------- Membres du foyer ----------
create table if not exists public.members (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.members enable row level security;

-- Vrai si l'utilisateur connecté fait partie du foyer.
-- security definer : lit "members" sans exposer la liste des membres.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Un membre peut voir sa propre ligne (la liste complète reste privée).
drop policy if exists "members: voir sa ligne" on public.members;
create policy "members: voir sa ligne" on public.members
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ---------- Données de l'app ----------
-- Même forme pour les trois tables : un id texte généré par l'app
-- et un document JSON (souple pour faire évoluer le prototype).
do $$
declare t text;
begin
  foreach t in array array['plants','tasks','groceries'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now(),
        updated_by text default (auth.jwt() ->> 'email')
      );
      alter table public.%1$I enable row level security;

      drop policy if exists "membres: lecture" on public.%1$I;
      create policy "membres: lecture" on public.%1$I
        for select to authenticated using (public.is_member());

      drop policy if exists "membres: ajout" on public.%1$I;
      create policy "membres: ajout" on public.%1$I
        for insert to authenticated with check (public.is_member());

      drop policy if exists "membres: modification" on public.%1$I;
      create policy "membres: modification" on public.%1$I
        for update to authenticated using (public.is_member()) with check (public.is_member());

      drop policy if exists "membres: suppression" on public.%1$I;
      create policy "membres: suppression" on public.%1$I
        for delete to authenticated using (public.is_member());
    $f$, t);
  end loop;
end $$;

-- Horodatage automatique des modifications
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

-- Synchronisation en temps réel entre appareils
do $$
begin
  begin alter publication supabase_realtime add table public.plants;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tasks;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.groceries; exception when duplicate_object then null; end;
end $$;

-- ---------- Abonnements aux notifications ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  email text not null default (auth.jwt() ->> 'email'),
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push: gérer ses abonnements" on public.push_subscriptions;
create policy "push: gérer ses abonnements" on public.push_subscriptions
  for all to authenticated
  using (public.is_member() and email = (auth.jwt() ->> 'email'))
  with check (public.is_member() and email = (auth.jwt() ->> 'email'));

-- =========================================================
-- À ADAPTER : les adresses e-mail du foyer
-- =========================================================
insert into public.members (email) values
  ('ton.adresse@exemple.fr')
  -- , ('adresse.de.ta.compagne@exemple.fr')
on conflict do nothing;
