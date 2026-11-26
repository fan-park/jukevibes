import { NextResponse } from "next/server";
import { forceSkip } from "@/lib/engine";
import { db, jsonError, readJson, requireGuest } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Host-only controls: skip, remove a request, change settings, end the session. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code, { host: true });
  if ("response" in auth) return auth.response;
  const { room } = auth;
  const body = await readJson(req);

  switch (body.action) {
    case "skip": {
      if (!room.now_playing) return jsonError(409, "Nothing is playing");
      try {
        await forceSkip(room, room.now_playing.id);
      } catch (err) {
        console.error(err);
        return jsonError(502, "Spotify didn't skip. Is Spotify open on your phone?");
      }
      return NextResponse.json({ ok: true });
    }
    case "remove": {
      await db()
        .from("requests")
        .update({ status: "removed" })
        .eq("id", String(body.requestId ?? ""))
        .eq("room_id", room.id)
        .eq("status", "pending");
      return NextResponse.json({ ok: true });
    }
    case "settings": {
      const updates: Record<string, unknown> = {};
      if (typeof body.voting_open === "boolean") updates.voting_open = body.voting_open;
      if (body.mode === "car" || body.mode === "party") updates.mode = body.mode;
      const ratio = Number(body.skip_ratio);
      if (Number.isFinite(ratio) && ratio > 0 && ratio <= 1) updates.skip_ratio = ratio;
      const max = Number(body.max_pending_per_guest);
      if (Number.isInteger(max) && max >= 1 && max <= 10) updates.max_pending_per_guest = max;
      if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim().slice(0, 40);
      if (Object.keys(updates).length) await db().from("rooms").update(updates).eq("id", room.id);
      return NextResponse.json({ ok: true });
    }
    case "end": {
      await db().from("rooms").update({ ended_at: new Date().toISOString() }).eq("id", room.id);
      return NextResponse.json({ ok: true });
    }
    default:
      return jsonError(400, "Unknown action");
  }
}
