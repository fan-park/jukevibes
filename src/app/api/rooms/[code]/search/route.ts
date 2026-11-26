import { NextResponse } from "next/server";
import { jsonError, requireGuest } from "@/lib/server";
import { searchTracks } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code);
  if ("response" in auth) return auth.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ tracks: [] });
  try {
    return NextResponse.json({ tracks: await searchTracks(auth.room.id, q) });
  } catch (err) {
    console.error(err);
    return jsonError(502, "Spotify search isn't working right now");
  }
}
