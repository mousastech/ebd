/**
 * Igreja e congregações: sede e filiais, supervisores regionais, dados da igreja (timbre) e fotos.
 * Toda gravação passa pelo ABAC (authorize), como no restante do sistema.
 */
import { authorize, can, ForbiddenError, type Subject } from "./abac";
import { db } from "./db";
import { UserError } from "./repo";
import { removeUpload } from "./uploads";

type Id = number;

export interface Congregation {
  id: Id;
  name: string;
  kind: "sede" | "filial";
  region: string | null;
  address: string | null;
  classes: number;
  students: number;
}

export const sedeId = (): Id =>
  (db().prepare(`SELECT id FROM congregations WHERE kind='sede' ORDER BY id LIMIT 1`).get() as { id: Id } | undefined)?.id ?? 1;

/** Congregações que o usuário alcança, com totais. */
export function listCongregations(u: Subject): Congregation[] {
  return (db()
    .prepare(
      `SELECT g.id, g.name, g.kind, g.region, g.address,
              (SELECT COUNT(*) FROM classes c WHERE c.congregation_id=g.id AND c.active=1) AS classes,
              (SELECT COUNT(DISTINCT e.person_id) FROM enrollments e JOIN classes c ON c.id=e.class_id
                 JOIN people p ON p.id=e.person_id AND p.active=1 WHERE c.congregation_id=g.id AND c.active=1) AS students
         FROM congregations g WHERE g.active=1 ORDER BY CASE g.kind WHEN 'sede' THEN 0 ELSE 1 END, g.name`,
    )
    .all() as Congregation[]).filter((c) => can(u, "read", { type: "congregation", congregationId: c.id }));
}

export function congregationName(id: Id | null | undefined): string | null {
  if (id == null) return null;
  return (db().prepare(`SELECT name FROM congregations WHERE id=?`).get(id) as { name: string } | undefined)?.name ?? null;
}

export function createCongregation(u: Subject, d: { name: string; region: string; address: string }): Id {
  authorize(u, "create", { type: "congregation" });
  if (!d.name.trim()) throw new UserError("Informe o nome da congregação.");
  try {
    return Number(
      db().prepare(`INSERT INTO congregations (name, kind, region, address) VALUES (?, 'filial', ?, ?)`)
        .run(d.name.trim(), d.region.trim() || null, d.address.trim() || null).lastInsertRowid,
    );
  } catch {
    throw new UserError("Já existe uma congregação com esse nome.");
  }
}

export function updateCongregation(u: Subject, id: Id, d: { name: string; region: string; address: string }): void {
  authorize(u, "update", { type: "congregation", congregationId: id });
  if (!d.name.trim()) throw new UserError("Informe o nome da congregação.");
  try {
    db().prepare(`UPDATE congregations SET name=?, region=?, address=? WHERE id=?`).run(d.name.trim(), d.region.trim() || null, d.address.trim() || null, id);
  } catch {
    throw new UserError("Já existe uma congregação com esse nome.");
  }
}

/** Congregações acompanhadas por um supervisor regional (definidas pelo Pastor/Presidente). */
export function setSupervisorCongregations(u: Subject, userId: Id, ids: Id[]): void {
  authorize(u, "update", { type: "congregation" });
  if (u.role !== "pastor") throw new ForbiddenError();
  const t = db().prepare(`SELECT role FROM users WHERE id=?`).get(userId) as { role: string } | undefined;
  if (!t) throw new UserError("Usuário não encontrado.");
  if (t.role !== "supervisor") throw new UserError("Esse usuário não é supervisor regional.");
  db().transaction(() => {
    db().prepare(`DELETE FROM user_congregations WHERE user_id=?`).run(userId);
    const ins = db().prepare(`INSERT INTO user_congregations (user_id, congregation_id) VALUES (?, ?)`);
    for (const id of new Set(ids)) ins.run(userId, id);
  })();
}

export function supervisorCongregations(userId: Id): Id[] {
  return (db().prepare(`SELECT congregation_id FROM user_congregations WHERE user_id=?`).all(userId) as { congregation_id: Id }[]).map(
    (r) => r.congregation_id,
  );
}

/** Move uma pessoa (e o login dela) para outra congregação. */
export function setPersonCongregation(u: Subject, personId: Id, congregationId: Id): void {
  const cur = db().prepare(`SELECT congregation_id FROM people WHERE id=?`).get(personId) as { congregation_id: Id } | undefined;
  if (!cur) throw new UserError("Pessoa não encontrada.");
  authorize(u, "update", { type: "person", personId, congregationId: cur.congregation_id });
  authorize(u, "update", { type: "person", personId, congregationId });
  db().prepare(`UPDATE people SET congregation_id=? WHERE id=?`).run(congregationId, personId);
}

// ───────────────────────────── dados da igreja (timbre)
export interface ChurchSettings {
  church_name: string;
  church_short: string;
  president: string;
  address: string;
  city: string;
  cnpj: string;
  lema: string;
  logo: string | null;
}

const DEFAULTS: ChurchSettings = {
  church_name: "Igreja Evangélica Assembleia de Deus",
  church_short: "EBD",
  president: "",
  address: "",
  city: "",
  cnpj: "",
  lema: process.env.EBD_LEMA ?? "#EBD FORTE IGREJA FORTE",
  logo: null,
};

export function getSettings(): ChurchSettings {
  const rows = db().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string | null }[];
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key in out && r.value !== null) (out as Record<string, string | null>)[r.key] = r.value;
  return out;
}

export function saveSettings(u: Subject, d: Partial<Omit<ChurchSettings, "logo">>): void {
  authorize(u, "update", { type: "settings", congregationId: sedeId() });
  const up = db().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  db().transaction(() => {
    for (const [k, v] of Object.entries(d)) {
      if (!(k in DEFAULTS) || k === "logo") continue;
      up.run(k, String(v ?? "").trim().slice(0, 300));
    }
  })();
}

export function setLogo(u: Subject, rel: string | null): void {
  authorize(u, "update", { type: "settings", congregationId: sedeId() });
  const old = getSettings().logo;
  db().prepare(`INSERT INTO settings (key, value) VALUES ('logo', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(rel);
  if (old && old !== rel) removeUpload(old);
}

// ───────────────────────────── foto de perfil
/** Quem pode editar o cadastro troca a foto; qualquer pessoa troca a própria. */
export function setPersonPhoto(u: Subject, personId: Id, rel: string | null): void {
  const p = db().prepare(`SELECT congregation_id, photo FROM people WHERE id=? AND active=1`).get(personId) as
    | { congregation_id: Id; photo: string | null } | undefined;
  if (!p) throw new UserError("Pessoa não encontrada.");
  if (personId !== u.personId) {
    const classIds = (db().prepare(`SELECT class_id FROM enrollments WHERE person_id=? UNION SELECT class_id FROM class_staff WHERE person_id=?`)
      .all(personId, personId) as { class_id: Id }[]).map((r) => r.class_id);
    authorize(u, "update", { type: "person", personId, classIds, congregationId: p.congregation_id });
  }
  db().prepare(`UPDATE people SET photo=? WHERE id=?`).run(rel, personId);
  if (p.photo && p.photo !== rel) removeUpload(p.photo);
}
