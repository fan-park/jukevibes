import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/engine";
import { db, env, type Room } from "@/lib/server";

export const dynamic = "force-dynamic";

/** How long after the last guest was seen a room keeps being driven by the server. */
const ACTIVE_HOURS = 3;

function authorised(req: Request): boolean {
  const expected = Buffer.from(`Bearer ${env("CRON_SECRET")}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Called every few seconds by a Supabase pg_cron job, so songs get queued even when
 * nobody has the page open (e.g. the host is in the Spotify app or the phone is locked).
 */
export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const since = new Date(Date.now() - ACTIVE_HOURS * 3_600_000).toISOString();
  const { data: active, error } = await db()
    .from("guests")
    .select("room_id")
    .gte("last_seen_at", since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const roomIds = [...new Set((active ?? []).map((g: { room_id: string }) => g.room_id))];
  if (roomIds.length === 0) return NextResponse.json({ rooms: 0 });

  const { data: rooms } = await db().from("rooms").select("*").in("id", roomIds).is("ended_at", null);
  await Promise.all(
    ((rooms ?? []) as Room[]).map((r) => tick({ ...r, skip_ratio: Number(r.skip_ratio) })),
  );
  return NextResponse.json({ rooms: rooms?.length ?? 0 });
}
