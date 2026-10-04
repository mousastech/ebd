/**
 * Entrar com Google (OAuth 2.0 / OpenID Connect, sem bibliotecas extras).
 * Só funciona com GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET configurados. A conta Google precisa ter o
 * MESMO e-mail (verificado) de um usuário já cadastrado: o login com Google não cria acessos novos.
 */
import { db } from "./db";

export const googleEnabled = (): boolean => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

/** Troca o código pelo perfil do usuário (token → userinfo). */
export async function exchangeCode(code: string, redirectUri: string, f: typeof fetch = fetch): Promise<GoogleProfile> {
  const tok = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, redirect_uri: redirectUri, grant_type: "authorization_code",
      client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });
  if (!tok.ok) throw new Error("Não foi possível confirmar o login com o Google.");
  const { access_token } = (await tok.json()) as { access_token?: string };
  const info = await f("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` } });
  if (!info.ok) throw new Error("Não foi possível ler o perfil do Google.");
  const p = (await info.json()) as GoogleProfile;
  if (!p.sub || !p.email) throw new Error("Perfil do Google incompleto.");
  return p;
}

/** Usuário do sistema para este perfil Google: pelo vínculo já feito ou pelo e-mail verificado (e vincula). */
export function userForGoogle(p: GoogleProfile): number | null {
  const linked = db().prepare(`SELECT id FROM users WHERE google_sub=?`).get(p.sub) as { id: number } | undefined;
  if (linked) return linked.id;
  if (!p.email_verified) return null;
  const byEmail = db().prepare(`SELECT id, google_sub FROM users WHERE lower(email)=lower(?)`).get(p.email) as
    | { id: number; google_sub: string | null } | undefined;
  if (!byEmail || (byEmail.google_sub && byEmail.google_sub !== p.sub)) return null;
  db().prepare(`UPDATE users SET google_sub=? WHERE id=?`).run(p.sub, byEmail.id);
  return byEmail.id;
}
