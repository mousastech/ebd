/**
 * Rotinas diárias automáticas (rodam sozinhas no servidor, uma vez por dia a partir das 7h):
 * cópia de segurança, aniversariantes, lembrete do professor escalado (sábado), lembrete de eventos
 * (véspera) e alerta de alunos com 3 faltas seguidas (segunda-feira).
 */
import type { Subject } from "./abac";
import { autoBackupIfDue } from "./backup";
import { db } from "./db";
import { todayISO } from "./format";
import { notifyUsers } from "./notify";
import { listAbsentees } from "./repo";

type Id = number;

/** Sujeito do próprio sistema (sem restrição), usado só por estas rotinas. */
const SYSTEM: Subject = {
  userId: 0, personId: 0, role: "pastor", coordinates: [], teaches: [], assists: [], secretaryOf: [], enrolled: [],
  congregations: null, allowedClasses: null, view: null,
};

const userOf = (personId: Id): Id | null =>
  (db().prepare(`SELECT id FROM users WHERE person_id=?`).get(personId) as { id: Id } | undefined)?.id ?? null;

/** Usuários que cuidam de uma classe: professores, secretário da sala, coordenador da Escala e secretaria geral/superintendência. */
function caretakers(classId: Id): Id[] {
  return (db()
    .prepare(`SELECT u.id FROM users u WHERE u.person_id IN (
                SELECT person_id FROM class_staff WHERE class_id=? AND function IN ('professor','secretario')
                UNION SELECT g.coordinator_id FROM classes c JOIN class_groups g ON g.id=c.group_id WHERE c.id=?)
              UNION
              SELECT u.id FROM users u JOIN people p ON p.id=u.person_id
               WHERE u.role IN ('superintendente','secretaria') AND p.congregation_id=(SELECT congregation_id FROM classes WHERE id=?)`)
    .all(classId, classId, classId) as { id: Id }[]).map((r) => r.id);
}

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function runDailyJobs(today = todayISO()): Record<string, number> {
  const out: Record<string, number> = {};
  autoBackupIfDue();

  // aniversariantes do dia
  const md = today.slice(5);
  const bdays = db()
    .prepare(`SELECT p.id, p.name, (SELECT class_id FROM enrollments WHERE person_id=p.id LIMIT 1) AS cls
                FROM people p WHERE p.active=1 AND substr(p.birth_date, 6) = ?`)
    .all(md) as { id: Id; name: string; cls: Id | null }[];
  out.aniversarios = 0;
  for (const b of bdays) {
    const me = userOf(b.id);
    if (me) out.aniversarios += notifyUsers([me], { title: `🎉 Feliz aniversário, ${b.name.split(" ")[0]}!`, body: "A EBD celebra a sua vida. Deus te abençoe!", url: "/" });
    if (b.cls) out.aniversarios += notifyUsers(caretakers(b.cls).filter((x) => x !== me), { title: `🎂 Hoje é aniversário de ${b.name}`, body: "Que tal mandar uma mensagem?", url: "/aniversariantes" });
  }

  // sábado: lembrete ao professor escalado para amanhã
  if (weekday(today) === 6) {
    const tomorrow = addDays(today, 1);
    const ls = db()
      .prepare(`SELECT l.teacher_id, c.name FROM lessons l JOIN classes c ON c.id=l.class_id
                 WHERE l.date=? AND l.kind='aula' AND l.status<>'cancelada' AND l.teacher_id IS NOT NULL`)
      .all(tomorrow) as { teacher_id: Id; name: string }[];
    out.escala = 0;
    for (const l of ls) {
      const uid = userOf(l.teacher_id);
      if (uid) out.escala += notifyUsers([uid], { title: "📖 Você está escalado(a) amanhã", body: `Classe ${l.name}. Bom preparo da lição!`, url: "/escala" });
    }
  }

  // véspera de eventos: lembra quem confirmou (sim/talvez)
  const tomorrow = addDays(today, 1);
  const evs = db().prepare(`SELECT id, title, starts_at FROM events WHERE substr(starts_at, 1, 10) = ?`).all(tomorrow) as { id: Id; title: string; starts_at: string }[];
  out.eventos = 0;
  for (const e of evs) {
    const people = (db().prepare(`SELECT person_id FROM event_rsvps WHERE event_id=? AND answer IN ('sim','talvez')`).all(e.id) as { person_id: Id }[])
      .map((r) => userOf(r.person_id)).filter((x): x is Id => x !== null);
    out.eventos += notifyUsers(people, { title: `⏰ Amanhã: ${e.title}`, body: `Às ${e.starts_at.slice(11)}`, url: "/agenda" });
  }

  // segunda-feira: alunos com 3 faltas seguidas → quem cuida da classe
  if (weekday(today) === 1) {
    out.ausentes = 0;
    const byClass = new Map<Id, string[]>();
    for (const a of listAbsentees(SYSTEM, 3, today)) byClass.set(a.class_id, [...(byClass.get(a.class_id) ?? []), a.name]);
    for (const [cls, names] of byClass)
      out.ausentes += notifyUsers(caretakers(cls), { title: `💛 ${names.length} aluno(s) com 3 faltas seguidas`, body: names.slice(0, 5).join(", "), url: "/admin" });
  }
  return out;
}

/** Executa as rotinas uma vez por dia, a partir das 7h (horário de Brasília). */
export function maybeRunDailyJobs(now = new Date()): boolean {
  if (process.env.EBD_JOBS === "0") return false;
  const today = todayISO(now);
  const hourBR = Number(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
  if (hourBR < 7) return false;
  const last = (db().prepare(`SELECT value FROM settings WHERE key='jobs_last_run'`).get() as { value: string } | undefined)?.value;
  if (last === today) return false;
  db().prepare(`INSERT INTO settings (key, value) VALUES ('jobs_last_run', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(today);
  try {
    runDailyJobs(today);
  } catch (e) {
    console.error("[rotinas diárias] falhou:", e);
  }
  return true;
}
