import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
}

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRoomCode(length = 5): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export type NowPlaying = {
  id: string;
  uri: string;
  name: string;
  artists: string;
  image: string | null;
  duration_ms: number;
  progress_ms: number;
  is_playing: boolean;
  fetched_at: string;
};

export type Room = {
  id: string;
  code: string;
  name: string;
  mode: "car" | "party";
  host_display_name: string | null;
  skip_ratio: number;
  max_pending_per_guest: number;
  voting_open: boolean;
  now_playing: NowPlaying | null;
  locked_request_id: string | null;
  last_skipped_track_id: string | null;
  created_at: string;
  last_active_at: string;
  ended_at: string | null;
};

export type Guest = {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  genre_vote: string | null;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
};

export async function loadRoom(code: string): Promise<Room | null> {
  const { data, error } = await db()
    .from("rooms")
    .select("*")
    .eq("code", normaliseCode(code))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, skip_ratio: Number(data.skip_ratio) } as Room;
}

const COOKIE_PREFIX = "jv_";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export async function setGuestCookie(code: string, guestId: string, token: string) {
  const store = await cookies();
  store.set(COOKIE_PREFIX + normaliseCode(code), `${guestId}.${token}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function currentGuest(room: Room): Promise<Guest | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_PREFIX + room.code)?.value;
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const guestId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(guestId)) return null;
  const { data } = await db()
    .from("guests")
    .select("*")
    .eq("id", guestId)
    .eq("room_id", room.id)
    .maybeSingle();
  if (!data) return null;
  return safeEqualHex(sha256(token), data.token_hash) ? (data as Guest) : null;
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Loads the room and the caller's guest record, or returns an error response. */
export async function requireGuest(
  code: string,
  opts: { host?: boolean; allowEnded?: boolean } = {},
): Promise<{ room: Room; guest: Guest } | { response: NextResponse }> {
  const room = await loadRoom(code);
  if (!room) return { response: jsonError(404, "Session not found") };
  if (room.ended_at && !opts.allowEnded) return { response: jsonError(410, "This session has ended") };
  const guest = await currentGuest(room);
  if (!guest) return { response: jsonError(401, "not_joined") };
  if (opts.host && !guest.is_host) return { response: jsonError(403, "Only the host can do that") };
  return { room, guest };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
