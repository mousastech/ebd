import crypto from "node:crypto";
import { cookies } from "next/headers";
import { googleAuthUrl, googleEnabled } from "@/lib/google";

export const dynamic = "force-dynamic";

const origin = (req: Request) => process.env.EBD_PUBLIC_URL ?? new URL(req.url).origin;

export async function GET(req: Request) {
  if (!googleEnabled()) return Response.redirect(new URL("/login?erro=Login%20com%20Google%20n%C3%A3o%20configurado.", req.url));
  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("ebd_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return Response.redirect(googleAuthUrl(`${origin(req)}/auth/google/callback`, state));
}
