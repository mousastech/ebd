/** Comunicados: publicados para um público (todos, grupo, Escala, classe), com leitura registrada e aviso no celular. */
import { authorize, can, ForbiddenError, type Subject } from "./abac";
import { audienceResource, describeAudience, matchesAudience, parseAudience, type Audience } from "./audience";
import { db } from "./db";
import { isISODate, todayISO } from "./format";
import { notifyUsers, usersWhere } from "./notify";
import { UserError } from "./repo";

type Id = number;
export interface Announcement extends Audience {
  id: Id;
  title: string;
  body: string;
  pinned: number;
  expires_at: string | null;
  created_at: string;
  author: string | null;
  audienceLabel: string;
  read: boolean;
  reads: number | null; // só para quem pode editar
  canEdit: boolean;
}

function row(id: Id) {
  const a = db().prepare(`SELECT * FROM announcements WHERE id=?`).get(id) as (Audience & { id: Id; title: string }) | undefined;
  if (!a) throw new UserError("Comunicado não encontrado.");
  return a;
}

export function listAnnouncements(u: Subject, opts: { includeExpired?: boolean } = {}): Announcement[] {
  const today = todayISO();
  const rows = db()
    .prepare(`SELECT a.*, p.name AS author,
                     EXISTS(SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.user_id=?) AS read,
                     (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id=a.id) AS reads
                FROM announcements a LEFT JOIN people p ON p.id=a.created_by
               ORDER BY a.pinned DESC, a.id DESC LIMIT 200`)
    .all(u.userId) as (Omit<Announcement, "audienceLabel" | "canEdit" | "read"> & { read: number })[];
  return rows
    .filter((a) => opts.includeExpired || !a.expires_at || a.expires_at >= today)
    .filter((a) => u.view == null || a.congregation_id === null || a.congregation_id === u.view)
    .filter((a) => can(u, "read", audienceResource("announcement", a)) && matchesAudience(u, a))
    .map((a) => {
      const canEdit = can(u, "update", audienceResource("announcement", a)) && (a.congregation_id !== null || u.role === "pastor");
      return { ...a, read: !!a.read, audienceLabel: describeAudience(a), canEdit, reads: canEdit ? a.reads : null };
    });
}

export function unreadAnnouncements(u: Subject): number {
  return listAnnouncements(u).filter((a) => !a.read).length;
}

export function createAnnouncement(
  u: Subject,
  d: { audience: string; title: string; body: string; pinned: boolean; expiresAt: string; allCongregations?: boolean; notify: boolean },
): Id {
  let a: Audience;
  try {
    a = parseAudience(d.audience, d.allCongregations ? null : u.view ?? u.home ?? 1);
  } catch {
    throw new UserError("Público inválido.");
  }
  if (a.congregation_id === null && u.role !== "pastor") throw new ForbiddenError("Só o Pastor/Presidente publica para todas as congregações.");
  authorize(u, "create", audienceResource("announcement", a));
  if (!d.title.trim() || !d.body.trim()) throw new UserError("Informe o título e o texto.");
  if (d.expiresAt && !isISODate(d.expiresAt)) throw new UserError("Data de validade inválida.");
  const id = Number(
    db()
      .prepare(`INSERT INTO announcements (congregation_id, audience_kind, audience_value, title, body, pinned, expires_at, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(a.congregation_id, a.audience_kind, a.audience_value, d.title.trim().slice(0, 120), d.body.trim().slice(0, 4000),
        d.pinned ? 1 : 0, d.expiresAt || null, u.personId, new Date().toISOString())
      .lastInsertRowid,
  );
  if (d.notify) notifyUsers(usersWhere((s) => s.userId !== u.userId && matchesAudience(s, a)), { title: `📢 ${d.title.trim()}`, body: d.body.trim().slice(0, 140), url: "/comunicados" });
  return id;
}

export function deleteAnnouncement(u: Subject, id: Id): void {
  const a = row(id);
  if (a.congregation_id === null && u.role !== "pastor") throw new ForbiddenError();
  authorize(u, "delete", audienceResource("announcement", a));
  db().prepare(`DELETE FROM announcements WHERE id=?`).run(id);
}

export function togglePin(u: Subject, id: Id): void {
  const a = row(id);
  if (a.congregation_id === null && u.role !== "pastor") throw new ForbiddenError();
  authorize(u, "update", audienceResource("announcement", a));
  db().prepare(`UPDATE announcements SET pinned = 1 - pinned WHERE id=?`).run(id);
}

/** Marca como lidos os comunicados que o usuário está vendo. */
export function markAnnouncementsRead(u: Subject, ids: Id[]): void {
  const ins = db().prepare(`INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();
  db().transaction(() => { for (const id of ids) ins.run(id, u.userId, now); })();
}

/** Opções de público que o usuário pode usar ao publicar. */
export function audienceOptions(u: Subject, type: "announcement" | "event") {
  const cong = u.view ?? u.home ?? 1;
  const opts: { value: string; label: string }[] = [];
  const base = { congregation_id: cong };
  const ok = (a: Audience) => can(u, "create", audienceResource(type, a));
  if (ok({ ...base, audience_kind: "todos", audience_value: null })) {
    opts.push({ value: "todos", label: "Todos" });
    for (const g of ["equipe", "professores", "alunos", "lideranca"]) opts.push({ value: `grupo:${g}`, label: describeAudience({ ...base, audience_kind: "grupo", audience_value: g }) });
  }
  const groups = db().prepare(`SELECT id, name FROM class_groups WHERE congregation_id=? ORDER BY id`).all(cong) as { id: Id; name: string }[];
  for (const g of groups) if (ok({ ...base, audience_kind: "escala", audience_value: String(g.id) })) opts.push({ value: `escala:${g.id}`, label: g.name });
  const classes = db().prepare(`SELECT id, name FROM classes WHERE congregation_id=? AND active=1 ORDER BY name`).all(cong) as { id: Id; name: string }[];
  for (const c of classes) if (ok({ ...base, audience_kind: "classe", audience_value: String(c.id) })) opts.push({ value: `classe:${c.id}`, label: `Classe ${c.name}` });
  return opts;
}
