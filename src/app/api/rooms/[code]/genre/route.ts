import { NextResponse } from "next/server";
import { db, jsonError, readJson, requireGuest } from "@/lib/server";
import { GENRES } from "@/lib/shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code);
  if ("response" in auth) return auth.response;

  const raw = (await readJson(req)).genre;
  const genre = raw === null || raw === "" ? null : String(raw);
  if (genre !== null && !(GENRES as readonly string[]).includes(genre)) return jsonError(400, "Unknown genre");

  await db().from("guests").update({ genre_vote: genre }).eq("id", auth.guest.id);
  return NextResponse.json({ ok: true });
}
