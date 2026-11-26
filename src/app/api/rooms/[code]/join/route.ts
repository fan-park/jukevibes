import { NextResponse } from "next/server";
import { currentGuest, db, jsonError, loadRoom, randomToken, readJson, setGuestCookie, sha256 } from "@/lib/server";

export const dynamic = "force-dynamic";

const MAX_GUESTS = 60;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = await loadRoom(code);
  if (!room) return jsonError(404, "Session not found. Check the code.");
  if (room.ended_at) return jsonError(410, "This session has ended");

  const body = await readJson(req);
  const nickname = String(body.nickname ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!nickname) return jsonError(400, "Pick a name so people know who requested what");

  const existing = await currentGuest(room);
  if (existing) {
    await db().from("guests").update({ nickname }).eq("id", existing.id);
    return NextResponse.json({ ok: true });
  }

  const { count } = await db()
    .from("guests")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id);
  if ((count ?? 0) >= MAX_GUESTS) return jsonError(403, "This session is full");

  const token = randomToken();
  const { data, error } = await db()
    .from("guests")
    .insert({ room_id: room.id, nickname, token_hash: sha256(token) })
    .select("id")
    .single();
  if (error || !data) return jsonError(500, "Couldn't join, try again");

  await setGuestCookie(room.code, data.id, token);
  return NextResponse.json({ ok: true });
}
