/**
 * Certificados de frequência do trimestre: alunos com presença (aulas validadas) igual ou acima do mínimo.
 * Emitidos pela secretaria, superintendência ou coordenador; o aluno imprime os próprios.
 */
import { authorize, can, type Subject } from "./abac";
import { db } from "./db";
import { quarterRange, type Quarter } from "./format";
import { listClasses } from "./repo";

type Id = number;
export interface CertificateRow {
  person_id: Id;
  name: string;
  class_id: Id;
  class_name: string;
  presentes: number;
  total: number;
  pct: number;
}

export const DEFAULT_MIN_PCT = 75;

function frequencyRows(classIds: Id[], q: Quarter, personId?: Id): CertificateRow[] {
  if (classIds.length === 0) return [];
  const { from, to } = quarterRange(q);
  return (db()
    .prepare(`SELECT p.id AS person_id, p.name, c.id AS class_id, c.name AS class_name,
                     SUM(a.present) AS presentes, COUNT(a.lesson_id) AS total
                FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 JOIN classes c ON c.id=e.class_id
                JOIN lessons l ON l.class_id=c.id AND l.report_status='validada' AND l.kind='aula' AND l.date BETWEEN ? AND ?
                JOIN attendance a ON a.lesson_id=l.id AND a.person_id=p.id
               WHERE c.id IN (${classIds.join(",")}) ${personId ? "AND p.id=?" : ""}
               GROUP BY p.id, c.id ORDER BY c.name, p.name`)
    .all(from, to, ...(personId ? [personId] : [])) as Omit<CertificateRow, "pct">[])
    .map((r) => ({ ...r, pct: r.total ? Math.round((r.presentes / r.total) * 100) : 0 }));
}

/** Alunos aptos (frequência >= mínimo) nas classes em que o usuário emite certificados. */
export function eligibleStudents(u: Subject, q: Quarter, minPct = DEFAULT_MIN_PCT, classId?: Id): CertificateRow[] {
  const classes = listClasses(u).filter((c) => (!classId || c.id === classId) && can(u, "create", { type: "certificate", classIds: [c.id] }));
  if (classes.length === 0) authorize(u, "create", { type: "certificate", classIds: classId ? [classId] : [-1] });
  return frequencyRows(classes.map((c) => c.id), q).filter((r) => r.pct >= minPct);
}

/** Certificados do próprio aluno no trimestre. */
export function myCertificates(u: Subject, q: Quarter, minPct = DEFAULT_MIN_PCT): CertificateRow[] {
  return frequencyRows(u.enrolled, q, u.personId).filter((r) => r.pct >= minPct && can(u, "read", { type: "certificate", personId: u.personId, classIds: [r.class_id] }));
}
