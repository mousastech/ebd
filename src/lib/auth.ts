import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { loadSubject, type SessionUser } from "./subject";

const COOKIE = "ebd_session";
const MAX_AGE_S = 60 * 60 * 12; // 12 horas

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Defina SESSION_SECRET (mínimo 16 caracteres) em produção.");
  }
  return "dev-only-secret-change-me";
}

// ───────── cookie de sessão assinado (HMAC-SHA256)
function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createToken(userId: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: now + MAX_AGE_S * 1000 })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "number" || typeof exp !== "number" || exp < now) return null;
    return u;
  } catch {
    return null;
  }
}

export async function startSession(userId: number): Promise<void> {
  (await cookies()).set(COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export type { SessionUser };

/** Cookie com a congregação escolhida na tela ("all" ou vazio = visão consolidada). */
export const VIEW_COOKIE = "ebd_cong";

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const id = readToken(jar.get(COOKIE)?.value);
  if (!id) return null;
  const v = Number(jar.get(VIEW_COOKIE)?.value);
  return loadSubject(id, Number.isInteger(v) && v > 0 ? v : null);
}

export async function setViewCongregation(id: number | null): Promise<void> {
  const jar = await cookies();
  if (id === null) jar.delete(VIEW_COOKIE);
  else jar.set(VIEW_COOKIE, String(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** Garante usuário autenticado; caso contrário redireciona ao login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function login(email: string, password: string): number | null {
  const row = db()
    .prepare(`SELECT id, password_hash FROM users WHERE lower(email) = lower(?)`)
    .get(email.trim()) as { id: number; password_hash: string } | undefined;
  // Mesmo custo quando o e-mail não existe, para não vazar quais e-mails são válidos.
  const ok = verifyPassword(password, row?.password_hash ?? hashPassword("dummy"));
  return row && ok ? row.id : null;
}
