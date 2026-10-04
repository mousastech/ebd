/**
 * Quiz das lições e pontuação (gamificação): o professor cria perguntas de múltipla escolha,
 * os alunos respondem uma vez; pontos = 10 por presença + 5 por acerto no trimestre.
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { isISODate, quarterRange, todayISO, type Quarter } from "./format";
import { listClasses, UserError } from "./repo";

type Id = number;
export const POINTS = { presenca: 10, acerto: 5 };

export interface QuizSummary {
  id: Id;
  class_id: Id;
  class_name: string;
  title: string;
  open_until: string | null;
  questions: number;
  attempts: number;
  myScore: number | null;
  open: boolean;
  canEdit: boolean;
  canAnswer: boolean;
}

const qres = (classId: Id): Resource => ({ type: "quiz", classIds: [classId] });

function quizRow(id: Id) {
  const q = db().prepare(`SELECT q.*, c.name AS class_name FROM quizzes q JOIN classes c ON c.id=q.class_id WHERE q.id=?`).get(id) as
    | { id: Id; class_id: Id; class_name: string; title: string; open_until: string | null; published: number } | undefined;
  if (!q) throw new UserError("Quiz não encontrado.");
  return q;
}

const isOpen = (q: { open_until: string | null }, today = todayISO()) => !q.open_until || q.open_until >= today;

export function listQuizzes(u: Subject): QuizSummary[] {
  const classes = new Map(listClasses(u).map((c) => [c.id, c]));
  const rows = db()
    .prepare(`SELECT q.id, q.class_id, c.name AS class_name, q.title, q.open_until,
                     (SELECT COUNT(*) FROM quiz_questions x WHERE x.quiz_id=q.id) AS questions,
                     (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id=q.id) AS attempts,
                     (SELECT score FROM quiz_attempts a WHERE a.quiz_id=q.id AND a.person_id=?) AS myScore
                FROM quizzes q JOIN classes c ON c.id=q.class_id WHERE q.published=1 ORDER BY q.id DESC LIMIT 200`)
    .all(u.personId) as Omit<QuizSummary, "open" | "canEdit" | "canAnswer">[];
  return rows
    .filter((q) => classes.has(q.class_id) && can(u, "read", qres(q.class_id)))
    .map((q) => ({
      ...q,
      open: isOpen(q),
      canEdit: can(u, "update", qres(q.class_id)),
      canAnswer: u.enrolled.includes(q.class_id) && q.myScore === null && isOpen(q),
    }));
}

export function createQuiz(
  u: Subject,
  d: { classId: Id; title: string; openUntil: string; questions: { text: string; options: string[]; correct: number }[] },
): Id {
  authorize(u, "create", qres(d.classId));
  if (!d.title.trim()) throw new UserError("Informe o título do quiz.");
  if (d.openUntil && !isISODate(d.openUntil)) throw new UserError("Data inválida.");
  const qs = d.questions
    .map((q) => ({ text: q.text.trim(), options: q.options.map((o) => o.trim()).filter(Boolean), correct: q.correct }))
    .filter((q) => q.text);
  if (qs.length === 0) throw new UserError("Inclua ao menos uma pergunta.");
  qs.forEach((q, i) => {
    if (q.options.length < 2) throw new UserError(`Pergunta ${i + 1}: informe ao menos duas alternativas.`);
    if (!(q.correct >= 0 && q.correct < q.options.length)) throw new UserError(`Pergunta ${i + 1}: marque a alternativa correta.`);
  });
  return db().transaction(() => {
    const id = Number(
      db().prepare(`INSERT INTO quizzes (class_id, title, open_until, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(d.classId, d.title.trim().slice(0, 120), d.openUntil || null, u.personId, new Date().toISOString()).lastInsertRowid,
    );
    const ins = db().prepare(`INSERT INTO quiz_questions (quiz_id, position, text, options, correct) VALUES (?, ?, ?, ?, ?)`);
    qs.forEach((q, i) => ins.run(id, i + 1, q.text.slice(0, 500), JSON.stringify(q.options.map((o) => o.slice(0, 200))), q.correct));
    return id;
  })();
}

export function deleteQuiz(u: Subject, id: Id): void {
  const q = quizRow(id);
  authorize(u, "delete", qres(q.class_id));
  db().prepare(`DELETE FROM quizzes WHERE id=?`).run(id);
}

/** Perguntas para responder (sem o gabarito) ou o resultado, se já respondeu. */
export function getQuiz(u: Subject, id: Id) {
  const q = quizRow(id);
  authorize(u, "read", qres(q.class_id));
  const questions = (db().prepare(`SELECT id, position, text, options, correct FROM quiz_questions WHERE quiz_id=? ORDER BY position`).all(id) as {
    id: Id; position: number; text: string; options: string; correct: number;
  }[]).map((x) => ({ ...x, options: JSON.parse(x.options) as string[] }));
  const attempt = db().prepare(`SELECT answers, score, total FROM quiz_attempts WHERE quiz_id=? AND person_id=?`).get(id, u.personId) as
    | { answers: string; score: number; total: number } | undefined;
  const canEdit = can(u, "update", qres(q.class_id));
  const reveal = !!attempt || canEdit;
  return {
    quiz: { ...q, open: isOpen(q) },
    questions: questions.map((x) => ({ id: x.id, position: x.position, text: x.text, options: x.options, correct: reveal ? x.correct : null })),
    attempt: attempt ? { answers: JSON.parse(attempt.answers) as number[], score: attempt.score, total: attempt.total } : null,
    canAnswer: !attempt && u.enrolled.includes(q.class_id) && isOpen(q),
    canEdit,
    results: canEdit
      ? (db().prepare(`SELECT p.name, a.score, a.total FROM quiz_attempts a JOIN people p ON p.id=a.person_id WHERE a.quiz_id=? ORDER BY a.score DESC, p.name`).all(id) as
          { name: string; score: number; total: number }[])
      : null,
  };
}

/** Resposta do aluno (uma vez por quiz). Só alunos matriculados na classe e com o quiz aberto. */
export function answerQuiz(u: Subject, id: Id, answers: number[]): { score: number; total: number } {
  const q = quizRow(id);
  authorize(u, "read", qres(q.class_id));
  if (!u.enrolled.includes(q.class_id)) throw new UserError("Só os alunos da classe respondem ao quiz.");
  if (!isOpen(q)) throw new UserError("Este quiz já foi encerrado.");
  const qs = db().prepare(`SELECT correct FROM quiz_questions WHERE quiz_id=? ORDER BY position`).all(id) as { correct: number }[];
  const score = qs.reduce((n, x, i) => n + (answers[i] === x.correct ? 1 : 0), 0);
  try {
    db().prepare(`INSERT INTO quiz_attempts (quiz_id, person_id, answers, score, total, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, u.personId, JSON.stringify(answers.slice(0, qs.length)), score, qs.length, new Date().toISOString());
  } catch {
    throw new UserError("Você já respondeu a este quiz.");
  }
  return { score, total: qs.length };
}

// ───────────────────────────── pontuação
export interface ScoreRow {
  id: Id;
  name: string;
  photo: string | null;
  presencas: number;
  acertos: number;
  pontos: number;
}

/** Ranking de pontos da classe no trimestre (presença validada + acertos nos quizzes da classe). */
export function classScores(u: Subject, classId: Id, q: Quarter): ScoreRow[] {
  if (!can(u, "read", qres(classId))) authorize(u, "read", { type: "consolidated", classIds: [classId] });
  const { from, to } = quarterRange(q);
  const rows = db()
    .prepare(`SELECT p.id, p.name, p.photo,
                (SELECT COUNT(*) FROM attendance a JOIN lessons l ON l.id=a.lesson_id
                  WHERE a.person_id=p.id AND a.present=1 AND l.class_id=? AND l.report_status='validada' AND l.date BETWEEN ? AND ?) AS presencas,
                (SELECT COALESCE(SUM(t.score),0) FROM quiz_attempts t JOIN quizzes z ON z.id=t.quiz_id
                  WHERE t.person_id=p.id AND z.class_id=? AND substr(t.created_at,1,10) BETWEEN ? AND ?) AS acertos
              FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 WHERE e.class_id=?`)
    .all(classId, from, to, classId, from, to, classId) as Omit<ScoreRow, "pontos">[];
  return rows
    .map((r) => ({ ...r, pontos: r.presencas * POINTS.presenca + r.acertos * POINTS.acerto }))
    .sort((a, b) => b.pontos - a.pontos || a.name.localeCompare(b.name));
}

/** Medalhas simples para o portal do aluno. */
export function badges(s: { presencas: number; acertos: number; aulas: number; pos: number }): string[] {
  const out: string[] = [];
  if (s.aulas > 0 && s.presencas === s.aulas) out.push("🏅 Presença 100%");
  else if (s.aulas > 0 && s.presencas / s.aulas >= 0.75) out.push("⭐ Assíduo");
  if (s.acertos >= 10) out.push("📚 Estudioso");
  if (s.pos === 1) out.push("🥇 1º lugar da turma");
  else if (s.pos > 0 && s.pos <= 3) out.push("🏆 Pódio da turma");
  return out;
}
