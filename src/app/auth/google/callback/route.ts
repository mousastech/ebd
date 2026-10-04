import { cookies } from "next/headers";
import { startSession } from "@/lib/auth";
import { exchangeCode, googleEnabled, userForGoogle } from "@/lib/google";

export const dynamic = "force-dynamic";

const back = (req: Request, msg: string) => Response.redirect(new URL(`/login?erro=${encodeURIComponent(msg)}`, req.url));

export async function GET(req: Request) {
  if (!googleEnabled()) return back(req, "Login com Google não configurado.");
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("ebd_oauth_state")?.value;
  jar.delete("ebd_oauth_state");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back(req, "Login com Google expirou. Tente de novo.");
  try {
    const origin = process.env.EBD_PUBLIC_URL ?? url.origin;
    const profile = await exchangeCode(code, `${origin}/auth/google/callback`);
    const userId = userForGoogle(profile);
    if (!userId) return back(req, `O e-mail ${profile.email} não tem acesso à EBD. Peça ao superintendente para cadastrá-lo.`);
    await startSession(userId);
    return Response.redirect(new URL("/", req.url));
  } catch (e) {
    return back(req, e instanceof Error ? e.message : "Falha no login com Google.");
  }
}
