/** Portal do aluno: frequência, pontos e posição na turma, quizzes pendentes, próxima lição e certificados. */
import type { Subject } from "./abac";
import { myCertificates } from "./certificates";
import { db } from "./db";
import { parseQuarter, quarterRange, shiftQuarter, todayISO } from "./format";
import { listLoans } from "./library";
import { badges, classScores, listQuizzes } from "./quiz";

export function studentPortal(u: Subject, today = todayISO()) {
  if (u.enrolled.length === 0) return null;
  const q = parseQuarter(undefined, today);
  const { from, to } = quarterRange(q);
  const classes = u.enrolled.map((classId) => {
    const name = (db().prepare(`SELECT name FROM classes WHERE id=?`).get(classId) as { name: string }).name;
    const freq = db()
      .prepare(`SELECT COUNT(*) total, COALESCE(SUM(a.present),0) presentes FROM attendance a JOIN lessons l ON l.id=a.lesson_id
                 WHERE a.person_id=? AND l.class_id=? AND l.report_status='validada' AND l.date BETWEEN ? AND ?`)
      .get(u.personId, classId, from, to) as { total: number; presentes: number };
    let scores: ReturnType<typeof classScores> = [];
    try {
      scores = classScores(u, classId, q);
    } catch {
      /* sem permissão de ver a pontuação desta classe */
    }
    const pos = scores.findIndex((s) => s.id === u.personId) + 1;
    const me = scores.find((s) => s.id === u.personId);
    const next = db()
      .prepare(`SELECT l.date, l.topic, p.name AS teacher, cu.golden_text, cu.reading FROM lessons l
                  LEFT JOIN people p ON p.id=l.teacher_id LEFT JOIN curriculum cu ON cu.id=l.curriculum_id
                 WHERE l.class_id=? AND l.date>=? AND l.kind='aula' AND l.status<>'cancelada' ORDER BY l.date LIMIT 1`)
      .get(classId, today) as { date: string; topic: string | null; teacher: string | null; golden_text: string | null; reading: string | null } | undefined;
    return {
      classId, name, presentes: freq.presentes, total: freq.total,
      pct: freq.total ? Math.round((freq.presentes / freq.total) * 100) : null,
      pontos: me?.pontos ?? 0, pos, turma: scores.length,
      badges: badges({ presencas: freq.presentes, acertos: me?.acertos ?? 0, aulas: freq.total, pos }),
      next: next ?? null,
    };
  });
  const pendingQuizzes = listQuizzes({ ...u, view: null }).filter((z) => z.canAnswer);
  const certificates = myCertificates(u, shiftQuarter(q, -1));
  const loans = listLoans({ ...u, view: null }, { open: true }).filter((l) => l.person_id === u.personId);
  return { quarter: q, classes, pendingQuizzes, certificates, prevQuarter: shiftQuarter(q, -1), loans };
}
