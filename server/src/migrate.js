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
`);

console.log("Database migrated.");
await pool.end();
