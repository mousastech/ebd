/**
 * Lições do trimestre (conforme a revista) e plano de aula do professor escalado.
 * As lições se ligam aos domingos da classe em ordem (pulando os domingos sem aula) e preenchem o tema.
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { quarterKey, quarterRange, type Quarter } from "./format";
import { listClasses, UserError } from "./repo";

type Id = number;
export interface CurriculumLesson {
  id: Id;
  number: number;
  title: string;
  golden_text: string | null;
  reading: string | null;
  date: string | null; // domingo em que foi aplicada
  lesson_id: Id | null;
  teacher: string | null;
  plan: string | null;
}

const cres = (classId: Id): Resource => ({ type: "curriculum", classIds: [classId] });

export function getCurriculum(u: Subject, classId: Id, q: Quarter): CurriculumLesson[] {
  authorize(u, "read", cres(classId));
  return db()
    .prepare(`SELECT c.id, c.number, c.title, c.golden_text, c.reading, l.date, l.id AS lesson_id, p.name AS teacher, l.plan
                FROM curriculum c LEFT JOIN lessons l ON l.curriculum_id=c.id LEFT JOIN people p ON p.id=l.teacher_id
               WHERE c.class_id=? AND c.quarter=? ORDER BY c.number`)
    .all(classId, quarterKey(q)) as CurriculumLesson[];
}

/**
 * Cadastra as lições colando o sumário da revista, uma por linha:
 *   "1. A Criação | Gn 1.1 | No princípio criou Deus…"  (título | leitura | texto áureo — os dois últimos opcionais)
 * Substitui as lições do trimestre e já as liga aos domingos da classe.
 */
export function saveCurriculum(u: Subject, classId: Id, q: Quarter, text: string): number {
  authorize(u, "update", cres(classId));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new UserError("Cole ao menos uma lição.");
  if (lines.length > 20) throw new UserError("Um trimestre tem no máximo 14 lições.");
  const items = lines.map((line, i) => {
    const m = /^(?:li[cç][aã]o\s*)?(\d{1,2})\s*[-.)–:]?\s*(.*)$/i.exec(line);
    const number = m ? Number(m[1]) : i + 1;
    const [title, reading, golden] = (m ? m[2] : line).split("|").map((x) => x.trim());
    if (!title) throw new UserError(`Linha ${i + 1}: informe o título da lição.`);
    return { number, title: title.slice(0, 160), reading: reading || null, golden: golden || null };
  });
  if (new Set(items.map((x) => x.number)).size !== items.length) throw new UserError("Há números de lição repetidos.");
  const key = quarterKey(q);
  db().transaction(() => {
    db().prepare(`UPDATE lessons SET curriculum_id=NULL WHERE curriculum_id IN (SELECT id FROM curriculum WHERE class_id=? AND quarter=?)`).run(classId, key);
    db().prepare(`DELETE FROM curriculum WHERE class_id=? AND quarter=?`).run(classId, key);
    const ins = db().prepare(`INSERT INTO curriculum (class_id, quarter, number, title, reading, golden_text) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const it of items) ins.run(classId, key, it.number, it.title, it.reading, it.golden);
  })();
  linkCurriculum(classId, q);
  return items.length;
}

/** Liga as lições aos domingos com aula, em ordem, e preenche o tema das aulas ainda sem tema. */
export function linkCurriculum(classId: Id, q: Quarter): void {
  const { from, to } = quarterRange(q);
  const lessons = db()
    .prepare(`SELECT id, topic FROM lessons WHERE class_id=? AND kind='aula' AND status<>'cancelada' AND date BETWEEN ? AND ? ORDER BY date`)
    .all(classId, from, to) as { id: Id; topic: string | null }[];
  const cur = db().prepare(`SELECT id, number, title FROM curriculum WHERE class_id=? AND quarter=? ORDER BY number`).all(classId, quarterKey(q)) as {
    id: Id; number: number; title: string;
  }[];
  // o tema automático ("Lição N — …") acompanha a lição; um tema escrito à mão é preservado
  const upd = db().prepare(`UPDATE lessons SET curriculum_id=?,
                              topic = CASE WHEN topic IS NULL OR topic = '' OR topic LIKE 'Lição %' THEN ? ELSE topic END WHERE id=?`);
  db().transaction(() => {
    db().prepare(`UPDATE lessons SET curriculum_id=NULL WHERE class_id=? AND date BETWEEN ? AND ?`).run(classId, from, to);
    cur.forEach((c, i) => {
      const l = lessons[i];
      if (l) upd.run(c.id, `Lição ${c.number} — ${c.title}`, l.id);
    });
  })();
}

/** Classes cujas lições o usuário pode consultar/editar. */
export function curriculumClasses(u: Subject) {
  return listClasses(u)
    .filter((c) => can(u, "read", cres(c.id)))
    .map((c) => ({ ...c, canEdit: can(u, "update", cres(c.id)) }));
}

// ───────────────────────────── plano de aula
export interface PlanLesson {
  id: Id;
  date: string;
  class_id: Id;
  class_name: string;
  teacher_id: Id | null;
  teacher: string | null;
  topic: string | null;
  plan: string | null;
  plan_updated_at: string | null;
  golden_text: string | null;
  reading: string | null;
  canEdit: boolean;
}

const pres = (l: { class_id: Id; teacher_id: Id | null }): Resource => ({ type: "plan", classIds: [l.class_id], teacherId: l.teacher_id });

/** Próximas aulas (e as últimas 2 semanas) com o plano de cada uma, no escopo do usuário. */
export function listPlans(u: Subject, from: string, to: string): PlanLesson[] {
  const rows = db()
    .prepare(`SELECT l.id, l.date, l.class_id, c.name AS class_name, l.teacher_id, p.name AS teacher, l.topic, l.plan, l.plan_updated_at,
                     cu.golden_text, cu.reading
                FROM lessons l JOIN classes c ON c.id=l.class_id LEFT JOIN people p ON p.id=l.teacher_id
                LEFT JOIN curriculum cu ON cu.id=l.curriculum_id
               WHERE l.kind='aula' AND l.status<>'cancelada' AND l.date BETWEEN ? AND ? ORDER BY l.date, c.name`)
    .all(from, to) as Omit<PlanLesson, "canEdit">[];
  const inView = new Set(listClasses(u).map((c) => c.id));
  return rows
    .filter((l) => inView.has(l.class_id) && can(u, "read", pres(l)))
    .map((l) => ({ ...l, canEdit: can(u, "update", pres(l)) }));
}

export function savePlan(u: Subject, lessonId: Id, plan: string): void {
  const l = db().prepare(`SELECT class_id, teacher_id, report_status FROM lessons WHERE id=?`).get(lessonId) as
    | { class_id: Id; teacher_id: Id | null; report_status: string } | undefined;
  if (!l) throw new UserError("Aula não encontrada.");
  authorize(u, "update", pres(l));
  if (l.report_status === "validada") throw new UserError("Aula já validada.");
  db().prepare(`UPDATE lessons SET plan=?, plan_updated_at=? WHERE id=?`).run(plan.trim().slice(0, 5000) || null, new Date().toISOString(), lessonId);
}
