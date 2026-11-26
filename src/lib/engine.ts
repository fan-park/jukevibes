import "server-only";
import { db, type Guest, type NowPlaying, type Room } from "./server";
import { addToQueue, currentlyPlaying, searchTracks, skipNext } from "./spotify";
import type { QueueItem, RoomState } from "./shared";

/** Lock in the next song when this much of the current song is left. */
const LOCK_WINDOW_MS = 25_000;
/** A queued song that still hasn't started after this long is treated as gone. */
const LOCK_TIMEOUT_MS = 15 * 60_000;
/** Guests seen within this window count as "in the room" for skip thresholds and genre votes. */
const ACTIVE_WINDOW_MS = 2 * 60_000;

type RequestRow = {
  id: string;
  guest_id: string | null;
  track_id: string;
  uri: string;
  name: string;
  artists: string;
  image: string | null;
  duration_ms: number | null;
  source: "guest" | "genre";
  status: "pending" | "queued" | "played" | "removed";
  created_at: string;
  queued_at: string | null;
};
type VoteRow = { request_id: string; guest_id: string; value: number };

function activeSince(): string {
  return new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
}

export async function activeGuests(roomId: string) {
  const { data, error } = await db()
    .from("guests")
    .select("id, nickname, is_host, genre_vote")
    .eq("room_id", roomId)
    .gte("last_seen_at", activeSince())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as { id: string; nickname: string; is_host: boolean; genre_vote: string | null }[];
}

export function skipVotesNeeded(room: Room, activeCount: number): number {
  return Math.max(1, Math.ceil(Math.max(activeCount, 1) * room.skip_ratio));
}

/**
 * Orders pending requests. Net votes come first; small boosts go to people who haven't
 * had a song played yet and to songs that have been waiting a while, so one loud voice
 * can't hog the queue.
 */
function rank(requests: RequestRow[], votes: VoteRow[], guestsWithPlays: Set<string>) {
  const now = Date.now();
  const tally = new Map<string, { score: number; ups: number; downs: number }>();
  for (const v of votes) {
    const t = tally.get(v.request_id) ?? { score: 0, ups: 0, downs: 0 };
    t.score += v.value;
    if (v.value > 0) t.ups++;
    else t.downs++;
    tally.set(v.request_id, t);
  }
  return requests
    .map((r) => {
      const t = tally.get(r.id) ?? { score: 0, ups: 0, downs: 0 };
      const waitedMin = (now - new Date(r.created_at).getTime()) / 60_000;
      const fairness = r.guest_id && !guestsWithPlays.has(r.guest_id) ? 0.5 : 0;
      const rankValue = t.score + fairness + Math.min(waitedMin * 0.05, 1);
      return { request: r, ...t, rankValue };
    })
    .sort(
      (a, b) =>
        b.rankValue - a.rankValue ||
        new Date(a.request.created_at).getTime() - new Date(b.request.created_at).getTime(),
    );
}

async function loadQueue(roomId: string) {
  const [pending, votes, history] = await Promise.all([
    db().from("requests").select("*").eq("room_id", roomId).eq("status", "pending"),
    db().from("votes").select("request_id, guest_id, value").eq("room_id", roomId),
    db().from("requests").select("guest_id").eq("room_id", roomId).in("status", ["queued", "played"]),
  ]);
  if (pending.error) throw pending.error;
  if (votes.error) throw votes.error;
  if (history.error) throw history.error;
  const guestsWithPlays = new Set(
    ((history.data ?? []) as { guest_id: string | null }[])
      .map((r) => r.guest_id)
      .filter((g): g is string => !!g),
  );
  return rank((pending.data ?? []) as RequestRow[], (votes.data ?? []) as VoteRow[], guestsWithPlays);
}

async function genreFallback(room: Room): Promise<RequestRow | null> {
  const guests = await activeGuests(room.id);
  const counts = new Map<string, number>();
  for (const g of guests) if (g.genre_vote) counts.set(g.genre_vote, (counts.get(g.genre_vote) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return null;

  const { data: recent } = await db()
    .from("requests")
    .select("track_id")
    .eq("room_id", room.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const seen = new Set<string>(((recent ?? []) as { track_id: string }[]).map((r) => r.track_id));
  if (room.now_playing) seen.add(room.now_playing.id);

  const offset = Math.floor(Math.random() * 5) * 10;
  const tracks = (await searchTracks(room.id, `genre:"${top}"`, offset)).filter((t) => !seen.has(t.id));
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  if (!track) return null;

  const { data, error } = await db()
    .from("requests")
    .insert({
      room_id: room.id,
      guest_id: null,
      track_id: track.id,
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      image: track.image,
      duration_ms: track.duration_ms,
      source: "genre",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RequestRow;
}

async function pickNext(room: Room): Promise<RequestRow | null> {
  const ranked = await loadQueue(room.id);
  // Songs the room has voted down (net negative) are passed over.
  const best = ranked.find((r) => r.score >= 0);
  if (best) return best.request;
  return genreFallback(room);
}

/**
 * The queue engine. Called on every state poll but runs at most once every few seconds
 * per room. Reads what Spotify is playing, marks finished requests, and near the end of
 * each song pushes the top-voted request into the host's Spotify queue.
 */
export async function tick(room: Room): Promise<Room> {
  if (room.ended_at) return room;
  const { data: claimed, error: claimError } = await db().rpc("claim_tick", {
    p_room_id: room.id,
    p_interval_seconds: 4,
  });
  if (claimError || !claimed) return room;

  try {
    const playing = await currentlyPlaying(room.id);
    const nowIso = new Date().toISOString();
    const nowPlaying: NowPlaying | null = playing
      ? { ...playing.track, progress_ms: playing.progress_ms, is_playing: playing.is_playing, fetched_at: nowIso }
      : null;

    let lockedId = room.locked_request_id;

    if (playing && playing.track.id !== room.now_playing?.id) {
      // A new song started. If it was one we queued, mark it played.
      await db()
        .from("requests")
        .update({ status: "played", played_at: nowIso })
        .eq("room_id", room.id)
        .eq("status", "queued")
        .eq("track_id", playing.track.id);
    }

    if (lockedId) {
      const { data: locked } = await db()
        .from("requests")
        .select("status, queued_at")
        .eq("id", lockedId)
        .maybeSingle();
      const stale =
        locked?.status === "queued" &&
        locked.queued_at &&
        Date.now() - new Date(locked.queued_at).getTime() > LOCK_TIMEOUT_MS;
      if (stale) {
        await db().from("requests").update({ status: "played", played_at: nowIso }).eq("id", lockedId);
      }
      if (!locked || locked.status !== "queued" || stale) lockedId = null;
    }

    if (playing && playing.is_playing && !lockedId && room.voting_open) {
      const remaining = playing.track.duration_ms - playing.progress_ms;
      if (remaining < LOCK_WINDOW_MS) {
        const next = await pickNext(room);
        if (next) {
          await addToQueue(room.id, next.uri);
          await db().from("requests").update({ status: "queued", queued_at: nowIso }).eq("id", next.id);
          lockedId = next.id;
        }
      }
    }

    const updates = { now_playing: nowPlaying, locked_request_id: lockedId, last_active_at: nowIso };
    await db().from("rooms").update(updates).eq("id", room.id);
    return { ...room, ...updates };
  } catch (err) {
    console.error("tick failed", room.code, err);
    return room;
  }
}

/** Counts a skip vote and skips the song if enough of the room wants it gone. */
export async function voteSkip(room: Room, guest: Guest): Promise<{ skipped: boolean }> {
  const track = room.now_playing;
  if (!track) return { skipped: false };
  await db()
    .from("skip_votes")
    .upsert({ room_id: room.id, track_id: track.id, guest_id: guest.id }, { ignoreDuplicates: true });
  const [{ count }, guests] = await Promise.all([
    db()
      .from("skip_votes")
      .select("guest_id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("track_id", track.id),
    activeGuests(room.id),
  ]);
  if ((count ?? 0) < skipVotesNeeded(room, guests.length)) return { skipped: false };
  return { skipped: await forceSkip(room, track.id) };
}

export async function forceSkip(room: Room, trackId: string): Promise<boolean> {
  const { data: claimed } = await db().rpc("claim_skip", { p_room_id: room.id, p_track_id: trackId });
  if (!claimed) return false;
  await skipNext(room.id);
  // Let the next poll re-read Spotify straight away.
  await db().from("room_secrets").update({ last_tick_at: null }).eq("room_id", room.id);
  return true;
}

export async function buildState(room: Room, guest: Guest): Promise<RoomState> {
  const nowIso = new Date().toISOString();
  await db().from("guests").update({ last_seen_at: nowIso }).eq("id", guest.id);

  const [ranked, guests, myVotes, skipVotes, myPending, locked, allGuests] = await Promise.all([
    loadQueue(room.id),
    activeGuests(room.id),
    db().from("votes").select("request_id, value").eq("room_id", room.id).eq("guest_id", guest.id),
    room.now_playing
      ? db().from("skip_votes").select("guest_id").eq("room_id", room.id).eq("track_id", room.now_playing.id)
      : Promise.resolve({ data: [] as { guest_id: string }[] }),
    db()
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("guest_id", guest.id)
      .eq("status", "pending"),
    room.locked_request_id
      ? db().from("requests").select("*").eq("id", room.locked_request_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db().from("guests").select("id, nickname").eq("room_id", room.id),
  ]);

  const names = new Map<string, string>(
    ((allGuests.data ?? []) as { id: string; nickname: string }[]).map((g) => [g.id, g.nickname]),
  );
  const mine = new Map<string, number>(
    ((myVotes.data ?? []) as { request_id: string; value: number }[]).map((v) => [v.request_id, v.value]),
  );
  const skippers = ((skipVotes.data ?? []) as { guest_id: string }[]).map((s) => s.guest_id);

  const queue: QueueItem[] = ranked.map((r) => ({
    id: r.request.id,
    track_id: r.request.track_id,
    name: r.request.name,
    artists: r.request.artists,
    image: r.request.image,
    duration_ms: r.request.duration_ms,
    requested_by: r.request.guest_id ? names.get(r.request.guest_id) ?? "Someone" : null,
    source: r.request.source,
    score: r.score,
    ups: r.ups,
    downs: r.downs,
    my_vote: (mine.get(r.request.id) ?? 0) as -1 | 0 | 1,
    mine: r.request.guest_id === guest.id,
  }));

  const genreCounts = new Map<string, number>();
  for (const g of guests) if (g.genre_vote) genreCounts.set(g.genre_vote, (genreCounts.get(g.genre_vote) ?? 0) + 1);

  const lockedRow = locked.data as RequestRow | null;
  const np = room.now_playing;

  return {
    room: {
      code: room.code,
      name: room.name,
      mode: room.mode,
      host_display_name: room.host_display_name,
      voting_open: room.voting_open,
      skip_ratio: room.skip_ratio,
      max_pending_per_guest: room.max_pending_per_guest,
      ended: !!room.ended_at,
    },
    me: {
      id: guest.id,
      nickname: guest.nickname,
      is_host: guest.is_host,
      genre_vote: guest.genre_vote,
      pending: myPending.count ?? 0,
    },
    now_playing: np
      ? {
          id: np.id,
          name: np.name,
          artists: np.artists,
          image: np.image,
          duration_ms: np.duration_ms,
          progress_ms: np.progress_ms,
          is_playing: np.is_playing,
          fetched_at: np.fetched_at,
        }
      : null,
    up_next:
      lockedRow && lockedRow.status === "queued"
        ? {
            id: lockedRow.id,
            name: lockedRow.name,
            artists: lockedRow.artists,
            image: lockedRow.image,
            requested_by: lockedRow.guest_id ? names.get(lockedRow.guest_id) ?? "Someone" : null,
          }
        : null,
    queue,
    skip: {
      votes: skippers.length,
      needed: skipVotesNeeded(room, guests.length),
      mine: skippers.includes(guest.id),
    },
    genres: [...genreCounts.entries()]
      .map(([genre, votes]) => ({ genre, votes }))
      .sort((a, b) => b.votes - a.votes),
    guests: guests.map((g) => ({ id: g.id, nickname: g.nickname, is_host: g.is_host })),
  };
}
