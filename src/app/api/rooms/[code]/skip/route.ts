import { NextResponse } from "next/server";
import { voteSkip } from "@/lib/engine";
import { db, jsonError, requireGuest } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Toggle the caller's vote to skip the song that's playing now. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code);
  if ("response" in auth) return auth.response;
  const { room, guest } = auth;
  if (!room.now_playing) return jsonError(409, "Nothing is playing");

  const { data: existing } = await db()
    .from("skip_votes")
    .select("guest_id")
    .eq("room_id", room.id)
    .eq("track_id", room.now_playing.id)
    .eq("guest_id", guest.id)
    .maybeSingle();
  if (existing) {
    await db()
      .from("skip_votes")
      .delete()
      .eq("room_id", room.id)
      .eq("track_id", room.now_playing.id)
      .eq("guest_id", guest.id);
    return NextResponse.json({ ok: true, skipped: false });
  }

  try {
    return NextResponse.json({ ok: true, ...(await voteSkip(room, guest)) });
  } catch (err) {
    console.error(err);
    return jsonError(502, "Spotify didn't skip. Is the host's Spotify open?");
  }
}
