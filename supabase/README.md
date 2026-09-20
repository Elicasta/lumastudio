# Supabase backend

LumaRig Studio owns the remote-control session.

The desktop app uses the public Supabase publishable key to call the session Edge
Function and join a Realtime channel. The secret/service-role key stays inside
Supabase and is never shipped with the Tauri bundle or companion remote.

## Files

- `migrations/202609200001_create_lumarig_remote_sessions.sql`
  creates the server-only session and pairing-attempt tables.
- `functions/lumarig-remote-session/index.ts`
  creates sessions, validates 6-digit pair codes, rotates pair codes, heartbeats
  Studio sessions, revokes sessions, rate-limits pairing, and cleans expired data.
- `config.toml`
  marks the pairing Edge Function as public at the gateway. Authorization happens
  inside the function because pairing starts before a Supabase user session exists.

## Client environment

The app can override the checked-in public defaults with:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Never add a Supabase secret/service-role key to a `VITE_` variable.
