import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appUrl, db, newRoomCode, randomToken, setGuestCookie, sha256 } from "@/lib/server";
import { exchangeCode, getMe } from "@/lib/spotify";

export const dynamic = "force-dynamic";

function fail(reason: string) {
  return NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent(reason)}`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  const saved = store.get("jv_oauth")?.value ?? "";
  store.delete("jv_oauth");

  if (url.searchParams.get("error")) return fail("Spotify login was cancelled.");
  const code = url.searchParams.get("code");
  const [savedState, mode] = saved.split(".");
  if (!code || !savedState || url.searchParams.get("state") !== savedState) {
    return fail("Login expired, please try again.");
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    tokens = await exchangeCode(code);
    me = await getMe(tokens.access_token);
  } catch (err) {
    console.error(err);
    return fail(
      "Spotify didn't accept the login. In Development Mode, the host's Spotify account must be added under User Management.",
    );
  }
  if (!tokens.refresh_token) return fail("Spotify didn't return a refresh token.");

  const hostName = me.display_name || "Host";
  let room: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 6 && !room; attempt++) {
    const { data, error } = await db()
      .from("rooms")
      .insert({
        code: newRoomCode(),
        name: `${hostName.split(" ")[0]}'s ${mode === "party" ? "party" : "ride"}`,
        mode: mode === "party" ? "party" : "car",
        host_display_name: hostName,
        skip_ratio: mode === "party" ? 0.6 : 0.5,
        max_pending_per_guest: mode === "party" ? 1 : 2,
      })
      .select("id, code")
      .single();
    if (!error) room = data;
    else if (error.code !== "23505") {
      console.error(error);
      return fail("Couldn't create the session.");
    }
  }
  if (!room) return fail("Couldn't create the session.");

  const guestToken = randomToken();
  const { data: guest, error: guestError } = await db()
    .from("guests")
    .insert({
      room_id: room.id,
      nickname: hostName.slice(0, 24),
      is_host: true,
      token_hash: sha256(guestToken),
    })
    .select("id")
    .single();
  const { error: secretError } = await db()
    .from("room_secrets")
    .insert({
      room_id: room.id,
      host_token_hash: sha256(guestToken),
      spotify_user_id: me.id,
      spotify_access_token: tokens.access_token,
      spotify_refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });
  if (guestError || secretError || !guest) {
    console.error(guestError ?? secretError);
    await db().from("rooms").delete().eq("id", room.id);
    return fail("Couldn't create the session.");
  }

  await setGuestCookie(room.code, guest.id, guestToken);
  return NextResponse.redirect(`${appUrl()}/host/${room.code}`);
}
