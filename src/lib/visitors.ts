/**
 * Visitantes e funil de conversão: visitou → retornou (2ª visita ou mais) → matriculado (vira aluno),
 * ou "perdido" quando a equipe desiste do contato. Escopo pela classe visitada e pela congregação.
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { isISODate, todayISO } from "./format";
import { listClasses, UserError } from "./repo";

type Id = number;
export type VisitorStatus = "visitante" | "retornou" | "matriculado" | "perdido";
export const VISITOR_LABEL: Record<VisitorStatus, string> = {
  visitante: "1ª visita", retornou: "Retornou", matriculado: "Matriculado", perdido: "Sem retorno",
};
export const HOW_FOUND = ["Convite de membro", "Familiar", "Rede social", "Passou na frente", "Evento da igreja", "Outro"];

export interface Visitor {
  id: Id;
  congregation_id: Id;
  class_id: Id | null;
  class_name: string | null;
  name: string;
  phone: string | null;
  how_found: string | null;
  invited_by: string | null;
  notes: string | null;
  status: VisitorStatus;
  person_id: Id | null;
  visits: number;
  first_visit: string | null;
  last_visit: string | null;
}

const vres = (v: { class_id: Id | null; congregation_id: Id }): Resource => ({
  type: "visitor", classIds: v.class_id ? [v.class_id] : [], congregationId: v.congregation_id,
});

function getVisitor(id: Id): Visitor {
  const v = db()
    .prepare(`SELECT v.*, c.name AS class_name,
                     (SELECT COUNT(*) FROM visitor_visits x WHERE x.visitor_id=v.id) AS visits,
                     (SELECT MIN(date) FROM visitor_visits x WHERE x.visitor_id=v.id) AS first_visit,
                     (SELECT MAX(date) FROM visitor_visits x WHERE x.visitor_id=v.id) AS last_visit
                FROM visitors v LEFT JOIN classes c ON c.id=v.class_id WHERE v.id=?`)
    .get(id) as Visitor | undefined;
  if (!v) throw new UserError("Visitante não encontrado.");
  return v;
}

export function listVisitors(u: Subject, opts: { status?: VisitorStatus } = {}): Visitor[] {
  const rows = db()
    .prepare(`SELECT v.*, c.name AS class_name,
                     (SELECT COUNT(*) FROM visitor_visits x WHERE x.visitor_id=v.id) AS visits,
                     (SELECT MIN(date) FROM visitor_visits x WHERE x.visitor_id=v.id) AS first_visit,
                     (SELECT MAX(date) FROM visitor_visits x WHERE x.visitor_id=v.id) AS last_visit
                FROM visitors v LEFT JOIN classes c ON c.id=v.class_id
               ${opts.status ? "WHERE v.status = ?" : ""}
               ORDER BY last_visit DESC, v.id DESC`)
    .all(...(opts.status ? [opts.status] : [])) as Visitor[];
  return rows
    .filter((v) => u.view == null || v.congregation_id === u.view)
    .filter((v) => can(u, "read", vres(v)));
}

/** Funil do período (por data da 1ª visita). */
export function visitorFunnel(u: Subject, from = "0000-01-01", to = "9999-12-31") {
  const vs = listVisitors(u).filter((v) => v.first_visit && v.first_visit >= from && v.first_visit <= to);
  const total = vs.length;
  const retornaram = vs.filter((v) => v.visits >= 2 || v.status === "matriculado").length;
  const matriculados = vs.filter((v) => v.status === "matriculado").length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : null);
  return { total, retornaram, matriculados, perdidos: vs.filter((v) => v.status === "perdido").length, pctRetorno: pct(retornaram), pctMatricula: pct(matriculados) };
}

function classCongregation(classId: Id): Id {
  const c = db().prepare(`SELECT congregation_id FROM classes WHERE id=? AND active=1`).get(classId) as { congregation_id: Id } | undefined;
  if (!c) throw new UserError("Classe não encontrada.");
  return c.congregation_id;
}

export function createVisitor(
  u: Subject,
  d: { name: string; phone: string; classId: Id | null; date: string; howFound: string; invitedBy: string; notes: string },
): Id {
  const cong = d.classId ? classCongregation(d.classId) : u.view ?? u.home ?? 1;
  authorize(u, "create", vres({ class_id: d.classId, congregation_id: cong }));
  if (!d.name.trim()) throw new UserError("Informe o nome do visitante.");
  const date = d.date || todayISO();
  if (!isISODate(date)) throw new UserError("Data inválida.");
  return db().transaction(() => {
    const id = Number(
      db()
        .prepare(`INSERT INTO visitors (congregation_id, class_id, name, phone, how_found, invited_by, notes, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(cong, d.classId, d.name.trim(), d.phone.trim() || null, d.howFound.trim() || null, d.invitedBy.trim() || null,
          d.notes.trim() || null, u.personId, new Date().toISOString())
        .lastInsertRowid,
    );
    db().prepare(`INSERT INTO visitor_visits (visitor_id, date, class_id) VALUES (?, ?, ?)`).run(id, date, d.classId);
    return id;
  })();
}

/** Registra mais uma visita; a partir da 2ª o status passa a "Retornou". */
export function addVisit(u: Subject, visitorId: Id, date: string): void {
  const v = getVisitor(visitorId);
  authorize(u, "create", vres(v));
  if (!isISODate(date)) throw new UserError("Data inválida.");
  db().transaction(() => {
    const r = db().prepare(`INSERT OR IGNORE INTO visitor_visits (visitor_id, date, class_id) VALUES (?, ?, ?)`).run(visitorId, date, v.class_id);
    if (r.changes === 0) throw new UserError("Essa visita já estava registrada.");
    if (v.status === "visitante" || v.status === "perdido") db().prepare(`UPDATE visitors SET status='retornou' WHERE id=?`).run(visitorId);
  })();
}

export function setVisitorStatus(u: Subject, visitorId: Id, status: "perdido" | "visitante"): void {
  const v = getVisitor(visitorId);
  authorize(u, "update", vres(v));
  if (v.status === "matriculado") throw new UserError("Visitante já matriculado.");
  const next = status === "visitante" ? (v.visits >= 2 ? "retornou" : "visitante") : "perdido";
  db().prepare(`UPDATE visitors SET status=? WHERE id=?`).run(next, visitorId);
}

/** Converte em aluno: cria o cadastro da pessoa e matricula na classe escolhida. */
export function enrollVisitor(u: Subject, visitorId: Id, classId: Id, birthDate: string): Id {
  const v = getVisitor(visitorId);
  authorize(u, "update", vres(v));
  authorize(u, "create", { type: "enrollment", classIds: [classId] });
  if (v.status === "matriculado") throw new UserError("Visitante já matriculado.");
  if (classCongregation(classId) !== v.congregation_id) throw new UserError("A classe é de outra congregação.");
  if (birthDate && !isISODate(birthDate)) throw new UserError("Data de nascimento inválida.");
  return db().transaction(() => {
    const pid = Number(
      db().prepare(`INSERT INTO people (name, phone, birth_date, congregation_id) VALUES (?, ?, ?, ?)`)
        .run(v.name, v.phone, birthDate || null, v.congregation_id).lastInsertRowid,
    );
    db().prepare(`INSERT INTO enrollments (class_id, person_id) VALUES (?, ?)`).run(classId, pid);
    db().prepare(`UPDATE visitors SET status='matriculado', person_id=?, class_id=? WHERE id=?`).run(pid, classId, visitorId);
    return pid;
  })();
}

export function deleteVisitor(u: Subject, visitorId: Id): void {
  const v = getVisitor(visitorId);
  authorize(u, "delete", vres(v));
  db().prepare(`DELETE FROM visitors WHERE id=?`).run(visitorId);
}

/** Classes em que o usuário pode registrar visitantes. */
export function visitorClasses(u: Subject) {
  return listClasses(u).filter((c) => can(u, "create", { type: "visitor", classIds: [c.id], congregationId: c.congregation_id }));
}

/** Nomes dos visitantes registrados numa aula (para conferência na tela da chamada). */
export function visitorsOn(classId: Id, date: string): string[] {
  return (db().prepare(`SELECT v.name FROM visitor_visits x JOIN visitors v ON v.id=x.visitor_id WHERE x.class_id=? AND x.date=? ORDER BY v.name`)
    .all(classId, date) as { name: string }[]).map((r) => r.name);
}
