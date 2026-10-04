/**
 * Notificações: ficam no sininho do app e, para quem ativou, chegam como push no celular/computador
 * (Web Push com chaves VAPID; geradas automaticamente na primeira vez se não vierem do ambiente).
 */
import webpush from "web-push";
import type { Subject } from "./abac";
import { db } from "./db";
import { loadSubject } from "./subject";

type Id = number;

export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const get = (k: string) => (db().prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value: string } | undefined)?.value;
  let pub = get("vapid_public");
  let priv = get("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    const up = db().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    up.run("vapid_public", pub);
    up.run("vapid_private", priv);
  }
  return { publicKey: pub, privateKey: priv };
}

export interface NotificationRow {
  id: Id;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

export function listNotifications(u: Subject, limit = 50): NotificationRow[] {
  return db()
    .prepare(`SELECT id, title, body, url, created_at, read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?`)
    .all(u.userId, limit) as NotificationRow[];
}

export function unreadCount(u: Subject): number {
  return (db().prepare(`SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL`).get(u.userId) as { n: number }).n;
}

export function markAllRead(u: Subject): void {
  db().prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL`).run(new Date().toISOString(), u.userId);
}

export function savePushSubscription(u: Subject, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Inscrição inválida.");
  db()
    .prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`)
    .run(u.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString());
}

export function removePushSubscription(u: Subject, endpoint: string): void {
  db().prepare(`DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?`).run(endpoint, u.userId);
}

export const pushEnabled = (u: Subject): boolean =>
  !!db().prepare(`SELECT 1 FROM push_subscriptions WHERE user_id=?`).get(u.userId);

/** Grava a notificação para cada usuário e dispara o push (em segundo plano; falhas não interrompem). */
export function notifyUsers(userIds: Id[], msg: { title: string; body?: string; url?: string }): number {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const ins = db().prepare(`INSERT INTO notifications (user_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?)`);
  db().transaction(() => {
    for (const id of ids) ins.run(id, msg.title.slice(0, 120), msg.body?.slice(0, 400) ?? null, msg.url ?? null, now);
  })();
  if (process.env.EBD_PUSH !== "0") void sendPush(ids, msg);
  return ids.length;
}

async function sendPush(userIds: Id[], msg: { title: string; body?: string; url?: string }) {
  const subs = db()
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${userIds.map(() => "?").join(",")})`)
    .all(...userIds) as { endpoint: string; p256dh: string; auth: string }[];
  if (subs.length === 0) return;
  const k = vapidKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:ebd@example.com", k.publicKey, k.privateKey);
  const payload = JSON.stringify({ title: msg.title, body: msg.body ?? "", url: msg.url ?? "/" });
  await Promise.all(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }).catch((e) => {
        if (e?.statusCode === 404 || e?.statusCode === 410) db().prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).run(s.endpoint);
      }),
    ),
  );
}

/** Usuários (ids) cujo sujeito satisfaz o filtro — usado para achar o público de um aviso. */
export function usersWhere(filter: (s: Subject) => boolean): Id[] {
  const ids = (db().prepare(`SELECT u.id FROM users u JOIN people p ON p.id=u.person_id WHERE p.active=1`).all() as { id: Id }[]).map((r) => r.id);
  return ids.filter((id) => {
    const s = loadSubject(id);
    return !!s && filter(s);
  });
}
