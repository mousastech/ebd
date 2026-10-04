/**
 * Indicadores pastorais: termômetro das classes (crescendo/estável/caindo), professores em destaque e
 * pedido de revistas sugerido pela média de presença. Usa apenas aulas VALIDADAS.
 */
import { can, type Subject } from "./abac";
import { db } from "./db";
import { quarterRange, shiftQuarter, type Quarter } from "./format";
import { listClasses } from "./repo";

type Id = number;
export type Trend = "crescendo" | "estavel" | "caindo" | "sem-dados";

export interface ClassThermo {
  id: Id;
  name: string;
  recent: number | null; // % nas últimas 4 aulas validadas
  before: number | null; // % nas 4 anteriores
  delta: number | null;
  trend: Trend;
  matriculados: number;
}

const pctOf = (rows: { p: number; n: number }[]) => {
  const n = rows.reduce((a, r) => a + r.n, 0);
  return n ? Math.round((rows.reduce((a, r) => a + r.p, 0) / n) * 100) : null;
};

export function classThermometer(u: Subject, today: string, window = 4): ClassThermo[] {
  return listClasses(u)
    .filter((c) => can(u, "read", { type: "consolidated", classIds: [c.id] }))
    .map((c) => {
      const ls = db()
        .prepare(`SELECT l.id,
                         (SELECT COALESCE(SUM(a.present),0) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id) p,
                         (SELECT COUNT(*) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id) n
                    FROM lessons l WHERE l.class_id=? AND l.report_status='validada' AND l.date<=? ORDER BY l.date DESC LIMIT ?`)
        .all(c.id, today, window * 2) as { p: number; n: number }[];
      const recent = pctOf(ls.slice(0, window));
      const before = ls.length > window ? pctOf(ls.slice(window)) : null;
      const delta = recent !== null && before !== null ? recent - before : null;
      const trend: Trend = delta === null ? "sem-dados" : delta >= 5 ? "crescendo" : delta <= -5 ? "caindo" : "estavel";
      const matriculados = (db().prepare(`SELECT COUNT(*) n FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 WHERE e.class_id=?`).get(c.id) as { n: number }).n;
      return { id: c.id, name: c.name, recent, before, delta, trend, matriculados };
    })
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
}

export interface TeacherScore {
  id: Id;
  name: string;
  photo: string | null;
  escaladas: number;
  presente: number; // aulas em que o professor estava presente
  mediaTurma: number | null; // % de presença dos alunos nas aulas dele
}

/** Professores no trimestre: assiduidade própria e presença média dos alunos nas aulas que deu. */
export function teacherRanking(u: Subject, quarter: Quarter): TeacherScore[] {
  const { from, to } = quarterRange(quarter);
  const classIds = listClasses(u).filter((c) => can(u, "read", { type: "consolidated", classIds: [c.id] })).map((c) => c.id);
  if (classIds.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, p.photo, COUNT(*) AS escaladas,
              SUM(COALESCE((SELECT a.present FROM attendance a WHERE a.lesson_id=l.id AND a.person_id=l.teacher_id),0)) AS presente,
              SUM((SELECT COALESCE(SUM(a.present),0) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id)) AS ap,
              SUM((SELECT COUNT(*) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id)) AS an
         FROM lessons l JOIN people p ON p.id=l.teacher_id
        WHERE l.class_id IN (${classIds.join(",")}) AND l.kind='aula' AND l.report_status='validada' AND l.date BETWEEN ? AND ?
        GROUP BY p.id`,
    )
    .all(from, to) as (Omit<TeacherScore, "mediaTurma"> & { ap: number; an: number })[];
  return rows
    .map(({ ap, an, ...r }) => ({ ...r, mediaTurma: an ? Math.round((ap / an) * 100) : null }))
    .sort((a, b) => b.presente / b.escaladas - a.presente / a.escaladas || (b.mediaTurma ?? 0) - (a.mediaTurma ?? 0) || b.escaladas - a.escaladas);
}

export interface MagazineSuggestion {
  classId: Id;
  name: string;
  matriculados: number;
  mediaPresentes: number | null;
  professores: number;
  alunos: number; // revistas de aluno sugeridas
  priceCents: number | null;
  totalCents: number | null;
}

/**
 * Pedido sugerido para o próximo trimestre: média de alunos presentes no trimestre-base (+10% de folga para
 * visitantes e novos alunos), nunca abaixo de metade dos matriculados; mais uma revista por professor.
 */
export function magazineSuggestion(u: Subject, base: Quarter): MagazineSuggestion[] {
  const { from, to } = quarterRange(base);
  return listClasses(u)
    .filter((c) => can(u, "read", { type: "material_order", classIds: [c.id] }) && can(u, "read", { type: "consolidated", classIds: [c.id] }))
    .map((c) => {
      const r = db()
        .prepare(`SELECT COUNT(*) aulas,
                         SUM((SELECT COALESCE(SUM(a.present),0) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id)) pres
                    FROM lessons l WHERE l.class_id=? AND l.report_status='validada' AND l.date BETWEEN ? AND ?`)
        .get(c.id, from, to) as { aulas: number; pres: number | null };
      const matriculados = (db().prepare(`SELECT COUNT(*) n FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 WHERE e.class_id=?`).get(c.id) as { n: number }).n;
      const professores = (db().prepare(`SELECT COUNT(*) n FROM class_staff WHERE class_id=? AND function='professor'`).get(c.id) as { n: number }).n;
      const media = r.aulas ? Math.round(((r.pres ?? 0) / r.aulas) * 10) / 10 : null;
      const alunos = media === null ? matriculados : Math.max(Math.ceil(media * 1.1), Math.ceil(matriculados / 2));
      const price = (db().prepare(`SELECT o.price_cents FROM material_orders o WHERE o.class_id=? ORDER BY o.id DESC LIMIT 1`).get(c.id) as { price_cents: number } | undefined)?.price_cents ?? null;
      return {
        classId: c.id, name: c.name, matriculados, mediaPresentes: media, professores, alunos, priceCents: price,
        totalCents: price === null ? null : price * (alunos + professores),
      };
    });
}

export const previousQuarter = (q: Quarter) => shiftQuarter(q, -1);
