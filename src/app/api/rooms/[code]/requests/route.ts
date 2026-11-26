import { NextResponse } from "next/server";
import { db, jsonError, readJson, requireGuest } from "@/lib/server";
import { getTrack } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code);
  if ("response" in auth) return auth.response;
  const { room, guest } = auth;

  if (!room.voting_open && !guest.is_host) return jsonError(403, "The host has paused requests");

  const trackId = String((await readJson(req)).trackId ?? "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) return jsonError(400, "Unknown song");

  // Already requested? Count it as an upvote instead of a duplicate.
  const { data: dup } = await db()
    .from("requests")
    .select("id")
    .eq("room_id", room.id)
    .eq("track_id", trackId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (dup) {
    await db()
      .from("votes")
      .upsert({ request_id: dup.id, guest_id: guest.id, room_id: room.id, value: 1 });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!guest.is_host) {
    const { count } = await db()
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("guest_id", guest.id)
      .eq("status", "pending");
    if ((count ?? 0) >= room.max_pending_per_guest) {
      return jsonError(
        429,
        `You already have ${room.max_pending_per_guest} song${room.max_pending_per_guest === 1 ? "" : "s"} waiting. Wait for one to play.`,
      );
    }
  }

  const track = await getTrack(room.id, trackId);
  if (!track) return jsonError(400, "Couldn't find that song on Spotify");

  const { data, error } = await db()
    .from("requests")
    .insert({
      room_id: room.id,
      guest_id: guest.id,
      track_id: track.id,
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      image: track.image,
      duration_ms: track.duration_ms,
    })
    .select("id")
    .single();
  if (error || !data) return jsonError(500, "Couldn't add your request");

  await db().from("votes").insert({ request_id: data.id, guest_id: guest.id, room_id: room.id, value: 1 });
  return NextResponse.json({ ok: true });
}
