import { query, pool } from "./db.js";

await query(`
  create extension if not exists "pgcrypto";

  create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    username text not null unique,
    password_hash text not null,
    role text not null default 'member',
    can_create_room boolean not null default false,
    created_at timestamptz not null default now()
  );

  create table if not exists rooms (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    livekit_name text not null unique,
    is_public boolean not null default false,
    max_members integer not null default 10,
    created_by uuid references users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  insert into rooms (name, livekit_name, is_public, max_members)
  values ('公共语音房', 'public', true, 99)
  on conflict (livekit_name) do nothing;

  alter table users alter column password_hash drop not null;
  alter table users add column if not exists display_name text;
  update users set display_name=username where display_name is null;

  create table if not exists auth_identities (
    provider text not null,
    subject text not null,
    user_id uuid not null references users(id) on delete cascade,
    primary key (provider, subject),
    unique (provider, user_id)
  );

  insert into auth_identities (provider, subject, user_id)
  select 'local', username, id from users where password_hash is not null
  on conflict do nothing;

  create table if not exists oauth_pending (
    state_hash text primary key,
    browser_hash text not null,
    verifier text not null,
    expires_at bigint not null
  );

  create table if not exists oauth_login_tickets (
    ticket_hash text primary key,
    user_id uuid not null references users(id) on delete cascade,
    expires_at bigint not null
  );
`);

console.log("Database migrated.");
await pool.end();
