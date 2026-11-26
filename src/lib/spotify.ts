import "server-only";
import { appUrl, db, env } from "./server";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

export function redirectUri(): string {
  return `${appUrl()}/api/auth/callback`;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env("SPOTIFY_CLIENT_ID"),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    show_dialog: "false",
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(`${env("SPOTIFY_CLIENT_ID")}:${env("SPOTIFY_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  );
}

export async function getMe(accessToken: string): Promise<{ id: string; display_name: string | null }> {
  const res = await fetch(`${API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify /me failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; display_name: string | null };
}

async function accessTokenFor(roomId: string, forceRefresh = false): Promise<string> {
  const { data, error } = await db()
    .from("room_secrets")
    .select("spotify_access_token, spotify_refresh_token, token_expires_at")
    .eq("room_id", roomId)
    .single();
  if (error || !data) throw new Error("Host Spotify connection not found");
  const expiresAt = new Date(data.token_expires_at).getTime();
  if (!forceRefresh && expiresAt - Date.now() > 60_000) return data.spotify_access_token;

  const refreshed = await tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.spotify_refresh_token }),
  );
  await db()
    .from("room_secrets")
    .update({
      spotify_access_token: refreshed.access_token,
      spotify_refresh_token: refreshed.refresh_token ?? data.spotify_refresh_token,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("room_id", roomId);
  return refreshed.access_token;
}

/** Calls the Spotify Web API on behalf of the room's host, refreshing the token once on 401. */
async function spotify(roomId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const run = (token: string) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  let res = await run(await accessTokenFor(roomId));
  if (res.status === 401) res = await run(await accessTokenFor(roomId, true));
  return res;
}

export type Track = {
  id: string;
  uri: string;
  name: string;
  artists: string;
  image: string | null;
  duration_ms: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTrack(item: any): Track {
  const images: { url: string; width?: number }[] = item?.album?.images ?? [];
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const image = (sorted.find((i) => (i.width ?? 0) >= 200) ?? sorted[sorted.length - 1])?.url ?? null;
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    image,
    duration_ms: item.duration_ms ?? 0,
  };
}

export async function searchTracks(roomId: string, query: string, offset = 0): Promise<Track[]> {
  const params = new URLSearchParams({ q: query, type: "track", limit: "10", offset: String(offset) });
  const res = await spotify(roomId, `/search?${params}`);
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const body = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (body?.tracks?.items ?? []).filter((t: any) => t && t.id && !t.is_local).map(toTrack);
}

export async function getTrack(roomId: string, trackId: string): Promise<Track | null> {
  const res = await spotify(roomId, `/tracks/${encodeURIComponent(trackId)}`);
  if (!res.ok) return null;
  return toTrack(await res.json());
}

export async function currentlyPlaying(
  roomId: string,
): Promise<{ track: Track; progress_ms: number; is_playing: boolean } | null> {
  const res = await spotify(roomId, "/me/player/currently-playing");
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify currently-playing failed: ${res.status}`);
  const body = await res.json();
  if (!body?.item || body.currently_playing_type !== "track") return null;
  return { track: toTrack(body.item), progress_ms: body.progress_ms ?? 0, is_playing: !!body.is_playing };
}

export async function addToQueue(roomId: string, uri: string): Promise<void> {
  const res = await spotify(roomId, `/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });
  if (!res.ok) throw new Error(`Spotify add-to-queue failed: ${res.status} ${await res.text()}`);
}

export async function skipNext(roomId: string): Promise<void> {
  const res = await spotify(roomId, "/me/player/next", { method: "POST" });
  if (!res.ok) throw new Error(`Spotify skip failed: ${res.status} ${await res.text()}`);
}
