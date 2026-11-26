# Jukevibe

The room picks the music. A host connects their Spotify (Premium); friends in the car or at the party
scan a QR code, pick a name, request songs, vote them up or down, vote to skip, and vote on a genre.
No app or Spotify account needed for guests.

## How it works

- **Host** logs in with Spotify (`/api/auth/login`). A session with a short code is created and the
  host lands on `/host/CODE` with a QR code.
- **Guests** open `/r/CODE`, pick a nickname (stored as an httpOnly cookie, no account).
- Every open page polls `/api/rooms/CODE/state` every 3 s. That call also runs the **queue engine**
  (`src/lib/engine.ts`, at most once every 4 s per room):
  - reads what's playing on the host's Spotify,
  - marks queued requests as played when they start,
  - ~25 s before the current song ends, adds the top-ranked request to the host's Spotify queue
    (Spotify's API can add to the queue but not reorder it, so the vote order lives in our DB),
  - if there are no requests, picks a song from the room's top-voted genre.
- **Ranking:** net votes, plus a small boost for people who haven't had a song played yet and for
  songs that have waited a while. Net-negative songs are passed over.
- **Skips:** a song is skipped when a share of active guests (host setting, default half) votes skip.

## Stack

Next.js (App Router) on Vercel, Supabase Postgres. All database access is server-side with the
Supabase secret key; RLS is on with no policies, so the public key can't read anything.

## Environment variables

See `.env.example`. `SPOTIFY_CLIENT_SECRET` and `SUPABASE_SECRET_KEY` are secrets — set them in
Vercel only.

## Spotify Development Mode limits

The app is in Development Mode: the owner needs Premium, and only accounts added under
**User Management** in the Spotify dashboard (max 5) can **host**. Guests don't count, because they
never log in to Spotify. Going public needs Spotify's Extended Quota approval.

## Local dev

```bash
cp .env.example .env.local   # fill in values, APP_URL=http://127.0.0.1:3000
npm install
npm run dev                  # http://127.0.0.1:3000 (Spotify doesn't allow "localhost")
```

Schema: `supabase/migrations/`.
