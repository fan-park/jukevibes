import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/server";
import { authorizeUrl } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode") === "party" ? "party" : "car";
  const state = randomToken(16);
  const store = await cookies();
  store.set("jv_oauth", `${state}.${mode}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state));
}
