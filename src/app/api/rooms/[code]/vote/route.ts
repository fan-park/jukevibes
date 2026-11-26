import { NextResponse } from "next/server";
import { db, jsonError, readJson, requireGuest } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code);
  if ("response" in auth) return auth.response;
  const { room, guest } = auth;

  const body = await readJson(req);
  const requestId = String(body.requestId ?? "");
  const value = Number(body.value);
  if (![-1, 0, 1].includes(value)) return jsonError(400, "Bad vote");

  const { data: request } = await db()
    .from("requests")
    .select("id, status")
    .eq("id", requestId)
    .eq("room_id", room.id)
    .maybeSingle();
  if (!request || request.status !== "pending") return jsonError(409, "That song is no longer up for a vote");

  if (value === 0) {
    await db().from("votes").delete().eq("request_id", request.id).eq("guest_id", guest.id);
  } else {
    await db().from("votes").upsert({ request_id: request.id, guest_id: guest.id, room_id: room.id, value });
  }
  return NextResponse.json({ ok: true });
}
