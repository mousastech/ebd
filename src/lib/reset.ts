/**
 * "Esqueci minha senha": sem e-mail automático, o pedido vai como notificação para quem pode redefinir
 * (superintendência da congregação da pessoa; Pastor/Presidente se não houver). A resposta é sempre a mesma,
 * para não revelar quais e-mails existem. No máximo um pedido a cada 15 minutos por conta.
 */
import { db } from "./db";
import { notifyUsers } from "./notify";

export function requestPasswordReset(email: string, now = Date.now()): void {
  const u = db()
    .prepare(`SELECT u.id, u.role, p.name, p.congregation_id FROM users u JOIN people p ON p.id=u.person_id WHERE lower(u.email)=lower(?)`)
    .get(email.trim()) as { id: number; role: string; name: string; congregation_id: number } | undefined;
  if (!u) return;
  const key = `reset_req_${u.id}`;
  const last = Number((db().prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined)?.value ?? 0);
  if (now - last < 15 * 60 * 1000) return;
  db().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(now));
  const global = u.role === "pastor" || u.role === "supervisor";
  let admins = global
    ? []
    : (db().prepare(`SELECT u.id FROM users u JOIN people p ON p.id=u.person_id WHERE u.role='superintendente' AND p.congregation_id=? AND u.id<>?`)
        .all(u.congregation_id, u.id) as { id: number }[]).map((r) => r.id);
  if (admins.length === 0) admins = (db().prepare(`SELECT id FROM users WHERE role='pastor' AND id<>?`).all(u.id) as { id: number }[]).map((r) => r.id);
  notifyUsers(admins, { title: `🔑 ${u.name} pediu para redefinir a senha`, body: `Conta: ${email.trim().toLowerCase()}. Em Usuários → Redefinir.`, url: "/usuarios" });
}
