-- Conversion Cycle Planner: database setup for Supabase.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- It is safe to run again: it only creates what is missing and replaces the functions.

-- ---------- tables ----------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- An invite lets an email address sign up. With a workspace_id it also adds
-- the person to that workspace when they first sign in. A row with no
-- workspace_id only allows sign-up (used to let yourself in the first time).
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

-- Everything a workspace has built (cycles, competitor offers, followed
-- competitors) lives in one document. version guards against two people
-- overwriting each other.
create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.emails (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  sent_at timestamptz not null,
  from_addr text,
  to_addr text,
  subject text,
  body text,
  primary key (workspace_id, id)
);
create index if not exists emails_by_workspace_date on public.emails (workspace_id, sent_at desc);

-- ---------- helpers ----------

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where workspace_id = ws and user_id = auth.uid() and role = 'owner');
$$;

-- Workspaces the signed-in person belongs to.
create or replace function public.my_workspaces()
returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, m.role
  from workspaces w join members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by w.created_at;
$$;

-- Create a workspace; the creator becomes its owner.
create or replace function public.create_workspace(ws_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into workspaces (name, created_by) values (left(trim(ws_name), 80), auth.uid()) returning id into new_id;
  insert into members (workspace_id, user_id, email, role)
    values (new_id, auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')), 'owner');
  insert into workspace_state (workspace_id) values (new_id);
  return new_id;
end $$;

-- Called after sign-in: joins every workspace this email was invited to.
create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  n integer := 0;
  r record;
begin
  if auth.uid() is null or em = '' then return 0; end if;
  for r in select * from invites where email = em and accepted_at is null and workspace_id is not null loop
    insert into members (workspace_id, user_id, email, role)
      values (r.workspace_id, auth.uid(), em, r.role)
      on conflict (workspace_id, user_id) do nothing;
    update invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Save the workspace document only if nobody saved in between.
-- Returns the new version, or null when someone else saved first.
create or replace function public.save_state(ws uuid, new_data jsonb, expected_version integer) returns integer
language plpgsql security invoker set search_path = public as $$
declare v integer;
begin
  update workspace_state
     set data = new_data, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where workspace_id = ws and version = expected_version
  returning version into v;
  return v;
end $$;

-- Sign-up gate: only invited emails may create an account.
-- Turn it on in Authentication -> Hooks -> "Before User Created" -> Postgres -> public.hook_before_user_created
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if em <> '' and exists (select 1 from invites where email = em) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email has not been invited to the Conversion Cycle Planner.'));
end $$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- ---------- access rules (row level security) ----------

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.workspace_state enable row level security;
alter table public.emails enable row level security;

drop policy if exists "members see workspace" on public.workspaces;
create policy "members see workspace" on public.workspaces for select to authenticated using (is_member(id));
drop policy if exists "owners rename workspace" on public.workspaces;
create policy "owners rename workspace" on public.workspaces for update to authenticated using (is_owner(id)) with check (is_owner(id));
drop policy if exists "owners delete workspace" on public.workspaces;
create policy "owners delete workspace" on public.workspaces for delete to authenticated using (is_owner(id));

drop policy if exists "members see members" on public.members;
create policy "members see members" on public.members for select to authenticated using (is_member(workspace_id));
drop policy if exists "owners change roles" on public.members;
create policy "owners change roles" on public.members for update to authenticated using (is_owner(workspace_id)) with check (is_owner(workspace_id));
drop policy if exists "owners remove members, anyone leaves" on public.members;
create policy "owners remove members, anyone leaves" on public.members for delete to authenticated using (is_owner(workspace_id) or user_id = auth.uid());

drop policy if exists "owners and invitee see invites" on public.invites;
create policy "owners and invitee see invites" on public.invites for select to authenticated
  using (is_owner(workspace_id) or email = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "owners invite" on public.invites;
create policy "owners invite" on public.invites for insert to authenticated
  with check (workspace_id is not null and is_owner(workspace_id));
drop policy if exists "owners cancel invites" on public.invites;
create policy "owners cancel invites" on public.invites for delete to authenticated using (is_owner(workspace_id));

drop policy if exists "members read state" on public.workspace_state;
create policy "members read state" on public.workspace_state for select to authenticated using (is_member(workspace_id));
drop policy if exists "members save state" on public.workspace_state;
create policy "members save state" on public.workspace_state for update to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));

drop policy if exists "members use emails" on public.emails;
create policy "members use emails" on public.emails for all to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));

-- ---------- let yourself in ----------
-- Replace the address below with your own work email, then run this file.
-- You can then sign in, create your first workspace and invite everyone else from the planner.
insert into public.invites (workspace_id, email) values (null, lower('you@yourcompany.com'))
on conflict do nothing;
