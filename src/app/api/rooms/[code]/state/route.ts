import { NextResponse } from "next/server";
import { buildState, tick } from "@/lib/engine";
import { requireGuest } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const auth = await requireGuest(code, { allowEnded: true });
  if ("response" in auth) return auth.response;
  const room = await tick(auth.room);
  return NextResponse.json(await buildState(room, auth.guest), {
    headers: { "Cache-Control": "no-store" },
  });
}
