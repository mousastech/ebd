/**
 * Camada de dados. TODA leitura e gravação passa por `can`/`authorize`:
 * as páginas e ações nunca consultam o banco diretamente.
 */
import { db } from "./db";
import {
  ForbiddenError, authorize, can, type ReportStatus, type Resource, type ResourceType, type Role, type Subject,
} from "./abac";
import { CATEGORIES, type Category, type ScheduleMode } from "./labels";
import { notifyUsers } from "./notify";
import { hashPassword } from "./password";
import {
  isISODate, isSunday, quarterLabel, quarterMonths, quarterRange, shiftQuarter, sundaysOfQuarter, todayISO, type Quarter,
} from "./format";

export class UserError extends Error {}

type Id = number;
const nowISO = (): string => new Date().toISOString();

// ───────────────────────────── aulas (base de escala, presença, diário e relatório)
interface RawLesson {
  id: Id; class_id: Id; class_name: string; date: string; kind: "aula" | "evento"; event_label: string | null;
  teacher_id: Id | null; teacher_name: string | null; topic: string | null; notes: string | null;
  visitors: number; offering_cents: number; status: string; secretary_absent: number;
  report_status: ReportStatus; return_note: string | null; submitted_by: Id | null; submitted_at: string | null;
  validated_by: Id | null; validated_at: string | null; has_secretary: number;
}

export interface Lesson extends Omit<RawLesson, "secretary_absent" | "has_secretary"> {
  secretary_absent: boolean;
  has_secretary: boolean;
}

export interface LessonRow extends Lesson {
  canEditSchedule: boolean;
}

const LESSON_SELECT = `
  SELECT l.id, l.class_id, c.name AS class_name, l.date, l.kind, l.event_label, l.teacher_id,
         p.name AS teacher_name, l.topic, l.notes, l.visitors, l.offering_cents, l.status,
         l.secretary_absent, l.report_status, l.return_note, l.submitted_by, l.submitted_at,
         l.validated_by, l.validated_at,
         EXISTS(SELECT 1 FROM class_staff s WHERE s.class_id = l.class_id AND s.function = 'secretario') AS has_secretary
    FROM lessons l JOIN classes c ON c.id = l.class_id LEFT JOIN people p ON p.id = l.teacher_id`;

const mapLesson = (r: RawLesson): Lesson => ({
  ...r,
  secretary_absent: r.secretary_absent === 1,
  has_secretary: r.has_secretary === 1,
});

const queryLessons = (where: string, ...args: unknown[]): Lesson[] =>
  (db().prepare(`${LESSON_SELECT} ${where}`).all(...args) as RawLesson[]).map(mapLesson);

function getLesson(lessonId: Id): Lesson {
  const l = queryLessons(`WHERE l.id = ?`, lessonId)[0];
  if (!l) throw new UserError("Aula não encontrada.");
  return l;
}

/** Atributos da aula repassados ao ABAC. */
const res = (type: ResourceType, l: Lesson): Resource => ({
  type,
  classIds: [l.class_id],
  teacherId: l.teacher_id,
  reportStatus: l.report_status,
  hasSecretary: l.has_secretary,
  secretaryAbsent: l.secretary_absent,
});

const isEditableStatus = (s: ReportStatus): boolean => s === "pendente" || s === "devolvida";

function requireClassDay(l: Lesson): void {
  if (l.kind === "evento") throw new UserError(`Este domingo não tem aula (${l.event_label ?? "evento"}).`);
  if (l.status === "cancelada") throw new UserError("Aula cancelada.");
}

// ───────────────────────────── classes
export interface ClassRow {
  id: Id;
  name: string;
  age_range: string | null;
  group_id: Id | null;
  congregation_id: Id;
}

/** Em ordem de congregação e Escala (1, 2, 3…) e, dentro dela, na ordem de cadastro. */
const allClasses = (): ClassRow[] =>
  db()
    .prepare(`SELECT id, name, age_range, group_id, congregation_id FROM classes WHERE active = 1
               ORDER BY congregation_id, COALESCE(group_id, 9999), id`)
    .all() as ClassRow[];

/**
 * Filtro de VISUALIZAÇÃO por congregação (a segurança fica no ABAC): quando o usuário escolheu uma congregação,
 * as listas mostram só o que é dela; sem escolha (visão consolidada), mostram tudo o que ele alcança.
 */
function viewFilter(u: Subject): (classId: Id) => boolean {
  if (u.view === null || u.view === undefined) return () => true;
  const cong = new Map(allClasses().map((c) => [c.id, c.congregation_id]));
  return (classId) => cong.get(classId) === u.view;
}

/** Congregação em que um novo registro é criado: a escolhida na tela ou a "de casa" do usuário. */
function targetCongregation(u: Subject): Id {
  return u.view ?? u.home ?? 1;
}

/** A pessoa existe, está ativa e é de uma congregação que o usuário alcança. */
function requireReachablePerson(u: Subject, personId: Id): void {
  const p = db().prepare(`SELECT congregation_id FROM people WHERE id=? AND active=1`).get(personId) as { congregation_id: Id } | undefined;
  if (!p) throw new UserError("Pessoa não encontrada.");
  if (u.congregations != null && !u.congregations.includes(p.congregation_id))
    throw new UserError("Essa pessoa é de outra congregação.");
}

const congregationOfClass = (classId: Id): Id | null =>
  (db().prepare(`SELECT congregation_id FROM classes WHERE id=?`).get(classId) as { congregation_id: Id } | undefined)?.congregation_id ?? null;

// ───────────────────────────── escalas (grupos de classes, cada um com um coordenador)
export interface GroupInfo {
  id: Id;
  name: string;
  coordinator_id: Id | null;
  coordinator: string | null;
  congregation_id: Id;
}

const groupInfo = (groupId: Id | null): GroupInfo | null =>
  groupId === null
    ? null
    : ((db()
        .prepare(`SELECT g.id, g.name, g.coordinator_id, p.name AS coordinator, g.congregation_id
                    FROM class_groups g LEFT JOIN people p ON p.id = g.coordinator_id WHERE g.id = ?`)
        .get(groupId) as GroupInfo | undefined) ?? null);

export function listGroups(u: Subject) {
  const visible = new Set(listClasses(u).map((c) => c.id));
  const classes = allClasses();
  return (
    db()
      .prepare(`SELECT g.id, g.name, g.coordinator_id, p.name AS coordinator, g.congregation_id
                  FROM class_groups g LEFT JOIN people p ON p.id = g.coordinator_id ORDER BY g.congregation_id, g.id`)
      .all() as GroupInfo[]
  )
    .filter((g) => u.view === null || u.view === undefined || g.congregation_id === u.view)
    .map((g) => ({ ...g, classes: classes.filter((c) => c.group_id === g.id && visible.has(c.id)) }))
    .filter((g) => g.classes.length > 0 || can(u, "update", { type: "user", congregationId: g.congregation_id }));
}

/** Designar o coordenador de uma Escala é decisão exclusiva da superintendência. */
export function setGroupCoordinator(u: Subject, groupId: Id, personId: Id | null): void {
  const g = groupInfo(groupId);
  if (!g) throw new UserError("Escala não encontrada.");
  authorize(u, "update", { type: "user", congregationId: g.congregation_id });
  if (personId !== null) requireReachablePerson(u, personId);
  db().prepare(`UPDATE class_groups SET coordinator_id=? WHERE id=?`).run(personId, groupId);
}

export function createGroup(u: Subject, name: string, coordinatorId: Id | null): Id {
  const cong = targetCongregation(u);
  authorize(u, "create", { type: "class", congregationId: cong });
  if (!name.trim()) throw new UserError("Informe o nome da escala.");
  try {
    return Number(db().prepare(`INSERT INTO class_groups (name, coordinator_id, congregation_id) VALUES (?, ?, ?)`).run(name.trim(), coordinatorId, cong).lastInsertRowid);
  } catch {
    throw new UserError("Já existe uma escala com esse nome.");
  }
}

export function setClassGroup(u: Subject, classId: Id, groupId: Id | null): void {
  authorize(u, "create", { type: "class", classIds: [classId] });
  const g = groupId === null ? null : groupInfo(groupId);
  if (groupId !== null && !g) throw new UserError("Escala não encontrada.");
  if (g && g.congregation_id !== congregationOfClass(classId)) throw new UserError("A Escala é de outra congregação.");
  db().prepare(`UPDATE classes SET group_id=? WHERE id=?`).run(groupId, classId);
}

export function listClasses(u: Subject): ClassRow[] {
  return allClasses()
    .filter((c) => u.view === null || u.view === undefined || c.congregation_id === u.view)
    .filter((c) => can(u, "read", { type: "class", classIds: [c.id] }));
}

export interface ClassCard extends ClassRow {
  students: number;
  professors: string[];
  group_name: string | null;
  coordinator: string | null;
  secretary: string | null;
}

export function listClassCards(u: Subject): ClassCard[] {
  return listClasses(u).map((c) => ({
    ...c,
    students: (
      db().prepare(`SELECT COUNT(*) n FROM enrollments e JOIN people p ON p.id=e.person_id
                    WHERE e.class_id=? AND p.active=1`).get(c.id) as { n: number }
    ).n,
    professors: staffNames(c.id, "professor"),
    group_name: groupInfo(c.group_id)?.name ?? null,
    coordinator: groupInfo(c.group_id)?.coordinator ?? null,
    secretary: staffNames(c.id, "secretario")[0] ?? null,
  }));
}

function staffNames(classId: Id, fn: string): string[] {
  return (
    db()
      .prepare(`SELECT p.name FROM class_staff s JOIN people p ON p.id=s.person_id
                WHERE s.class_id=? AND s.function=? AND p.active=1 ORDER BY s.rowid`)
      .all(classId, fn) as { name: string }[]
  ).map((r) => r.name);
}

export function createClass(u: Subject, name: string, ageRange: string, groupId: Id | null = null): Id {
  const g = groupId === null ? null : groupInfo(groupId);
  if (groupId !== null && !g) throw new UserError("Escala não encontrada.");
  const cong = g?.congregation_id ?? targetCongregation(u);
  authorize(u, "create", { type: "class", congregationId: cong });
  if (!name.trim()) throw new UserError("Informe o nome da classe.");
  return Number(
    db().prepare(`INSERT INTO classes (name, age_range, group_id, congregation_id) VALUES (?, ?, ?, ?)`)
      .run(name.trim(), ageRange.trim() || null, groupId, cong).lastInsertRowid,
  );
}

export interface StaffRow {
  person_id: Id;
  name: string;
  function: string;
}

export function getClassDetail(u: Subject, classId: Id) {
  authorize(u, "read", { type: "class", classIds: [classId] });
  const cls = db().prepare(`SELECT id, name, age_range, group_id, congregation_id FROM classes WHERE id=? AND active=1`).get(classId) as
    | ClassRow
    | undefined;
  if (!cls) return null;
  const staff = db()
    .prepare(`SELECT s.person_id, p.name, s.function FROM class_staff s JOIN people p ON p.id=s.person_id
              WHERE s.class_id=? AND p.active=1
              ORDER BY CASE s.function WHEN 'secretario' THEN 1 WHEN 'professor' THEN 2 ELSE 3 END, s.rowid`)
    .all(classId) as StaffRow[];
  const students = listPeople(u).filter((p) => p.studentOf.includes(classId));
  return {
    cls,
    staff,
    students,
    group: groupInfo(cls.group_id),
    canEdit: can(u, "update", { type: "class", classIds: [classId] }),
    canEnroll: can(u, "create", { type: "enrollment", classIds: [classId] }),
    canMove: can(u, "create", { type: "class" }), // mudar a classe de Escala: só a superintendência
  };
}

export function addStaff(u: Subject, classId: Id, personId: Id, fn: string): void {
  authorize(u, "update", { type: "class", classIds: [classId] });
  if (!["professor", "secretario", "colaborador"].includes(fn)) throw new UserError("Função inválida.");
  requireReachablePerson(u, personId);
  db().transaction(() => {
    // Cada sala tem um único secretário: designar outro substitui o atual.
    if (fn === "secretario") db().prepare(`DELETE FROM class_staff WHERE class_id=? AND function='secretario'`).run(classId);
    db().prepare(`INSERT OR IGNORE INTO class_staff (class_id, person_id, function) VALUES (?, ?, ?)`).run(classId, personId, fn);
  })();
}

export function removeStaff(u: Subject, classId: Id, personId: Id, fn: string): void {
  authorize(u, "update", { type: "class", classIds: [classId] });
  db().prepare(`DELETE FROM class_staff WHERE class_id=? AND person_id=? AND function=?`).run(classId, personId, fn);
}

export function enrollStudent(u: Subject, classId: Id, personId: Id): void {
  authorize(u, "create", { type: "enrollment", classIds: [classId] });
  requireReachablePerson(u, personId);
  db().prepare(`INSERT OR IGNORE INTO enrollments (class_id, person_id) VALUES (?, ?)`).run(classId, personId);
}

export function unenrollStudent(u: Subject, classId: Id, personId: Id): void {
  authorize(u, "delete", { type: "enrollment", classIds: [classId] });
  db().prepare(`DELETE FROM enrollments WHERE class_id=? AND person_id=?`).run(classId, personId);
}

// ───────────────────────────── pessoas (cadastro único: alunos, professores, coordenadores, staff)
export interface PersonRow {
  congregation_id: Id;
  photo: string | null;
  email: string | null;
  id: Id;
  name: string;
  birth_date: string | null;
  phone: string | null; // null = sem permissão para ver
  guardian_name: string | null;
  studentOf: Id[];
  staffOf: { classId: Id; function: string }[];
  classIds: Id[];
  categories: Category[];
}

interface RawPerson {
  id: Id;
  name: string;
  birth_date: string | null;
  phone: string | null;
  guardian_name: string | null;
  congregation_id: Id;
  photo: string | null;
  email: string | null;
}

function rawPeople(): (RawPerson & Pick<PersonRow, "studentOf" | "staffOf" | "classIds" | "categories">)[] {
  const people = db()
    .prepare(`SELECT id, name, birth_date, phone, guardian_name, congregation_id, photo, email FROM people WHERE active=1 ORDER BY name`)
    .all() as RawPerson[];
  const enr = db().prepare(`SELECT class_id, person_id FROM enrollments`).all() as { class_id: Id; person_id: Id }[];
  const stf = db().prepare(`SELECT class_id, person_id, function FROM class_staff`).all() as {
    class_id: Id; person_id: Id; function: string;
  }[];
  const roles = db().prepare(`SELECT person_id, role FROM users`).all() as { person_id: Id; role: Role }[];
  const coord = db()
    .prepare(`SELECT g.coordinator_id AS person_id, c.id AS class_id FROM class_groups g
              JOIN classes c ON c.group_id = g.id AND c.active = 1 WHERE g.coordinator_id IS NOT NULL`)
    .all() as { person_id: Id; class_id: Id }[];
  return people.map((p) => {
    const studentOf = enr.filter((e) => e.person_id === p.id).map((e) => e.class_id);
    const staffOf = [
      ...coord.filter((c) => c.person_id === p.id).map((c) => ({ classId: c.class_id, function: "coordenador" })),
      ...stf.filter((s) => s.person_id === p.id).map((s) => ({ classId: s.class_id, function: s.function })),
    ];
    const classIds = [...new Set([...studentOf, ...staffOf.map((s) => s.classId)])];
    const cats = new Set<Category>();
    if (studentOf.length) cats.add("aluno");
    for (const s of staffOf) cats.add(s.function as Category);
    if (roles.some((r) => r.person_id === p.id && ["pastor", "supervisor", "superintendente", "secretaria"].includes(r.role))) cats.add("geral");
    return { ...p, studentOf, staffOf, classIds, categories: CATEGORIES.filter((c) => cats.has(c)) };
  });
}

/** Pessoas que o usuário pode ver; contatos só aparecem com `read_sensitive`. */
/** Atributos de uma pessoa para o ABAC (inclui a congregação). */
const personRes = (type: ResourceType, p: { id: Id; classIds: Id[]; congregation_id: Id }): Resource => ({
  type, personId: p.id, classIds: p.classIds, congregationId: p.congregation_id,
});

/** A pessoa aparece na congregação escolhida se for dela ou atuar numa classe dela. */
function personInView(u: Subject): (p: { congregation_id: Id; classIds: Id[] }) => boolean {
  if (u.view === null || u.view === undefined) return () => true;
  const inV = viewFilter(u);
  return (p) => p.congregation_id === u.view || p.classIds.some(inV);
}

export function listPeople(u: Subject): PersonRow[] {
  const inView = personInView(u);
  return rawPeople()
    .filter(inView)
    .filter((p) => can(u, "read", personRes("person", p)))
    .map((p) => {
      const sensitive = can(u, "read_sensitive", personRes("person", p));
      return { ...p, phone: sensitive ? p.phone : null, guardian_name: sensitive ? p.guardian_name : null };
    });
}

export function createPerson(
  u: Subject,
  d: { name: string; birth_date: string; phone: string; guardian_name: string; classId?: Id },
): Id {
  const cong = (d.classId ? congregationOfClass(d.classId) : null) ?? targetCongregation(u);
  authorize(u, "create", { type: "person", congregationId: cong });
  if (!d.name.trim()) throw new UserError("Informe o nome.");
  if (d.birth_date && !isISODate(d.birth_date)) throw new UserError("Data de nascimento inválida.");
  if (d.classId) authorize(u, "create", { type: "enrollment", classIds: [d.classId] });
  const id = Number(
    db()
      .prepare(`INSERT INTO people (name, birth_date, phone, guardian_name, congregation_id) VALUES (?, ?, ?, ?, ?)`)
      .run(d.name.trim(), d.birth_date || null, d.phone.trim() || null, d.guardian_name.trim() || null, cong)
      .lastInsertRowid,
  );
  if (d.classId) db().prepare(`INSERT INTO enrollments (class_id, person_id) VALUES (?, ?)`).run(d.classId, id);
  return id;
}

export function updatePerson(
  u: Subject,
  id: Id,
  d: { name: string; birth_date: string; phone: string; guardian_name: string },
): void {
  const p = rawPeople().find((x) => x.id === id);
  if (!p) throw new UserError("Pessoa não encontrada.");
  authorize(u, "update", personRes("person", p));
  if (!d.name.trim()) throw new UserError("Informe o nome.");
  if (d.birth_date && !isISODate(d.birth_date)) throw new UserError("Data de nascimento inválida.");
  db()
    .prepare(`UPDATE people SET name=?, birth_date=?, phone=?, guardian_name=? WHERE id=?`)
    .run(d.name.trim(), d.birth_date || null, d.phone.trim() || null, d.guardian_name.trim() || null, id);
}

// ───────────────────────────── aniversariantes (alunos, professores, coordenadores e staff)
export interface Birthday {
  id: Id;
  name: string;
  month: number;
  day: number;
  turning: number;
  classes: string[];
  categories: Category[];
  isToday: boolean;
}

export function listBirthdays(u: Subject, today = todayISO()): Birthday[] {
  const names = new Map(allClasses().map((c) => [c.id, c.name]));
  const [ty, tm, td] = today.split("-").map(Number);
  const inView = personInView(u);
  return rawPeople()
    .filter(inView)
    .filter((p) => p.birth_date && can(u, "read", personRes("birthday", p)))
    .map((p) => {
      const [y, m, d] = p.birth_date!.split("-").map(Number);
      return {
        id: p.id,
        name: p.name,
        month: m,
        day: d,
        turning: ty - y,
        classes: p.classIds.map((c) => names.get(c)).filter((x): x is string => !!x),
        categories: p.categories,
        isToday: m === tm && d === td,
      };
    })
    .sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name));
}

// ───────────────────────────── escala por trimestre
export function professorsOf(classId: Id): { id: Id; name: string }[] {
  return db()
    .prepare(`SELECT p.id, p.name FROM class_staff s JOIN people p ON p.id=s.person_id
              WHERE s.class_id=? AND s.function='professor' AND p.active=1 ORDER BY s.rowid`)
    .all(classId) as { id: Id; name: string }[];
}

export function listSchedule(u: Subject, opts: { from?: string; to?: string } = {}): LessonRow[] {
  const inView = viewFilter(u);
  return queryLessons(`WHERE l.date >= ? AND l.date <= ? ORDER BY l.date, c.id`, opts.from ?? "0000-01-01", opts.to ?? "9999-12-31")
    .filter((l) => inView(l.class_id))
    .filter((l) => can(u, "read", { type: "schedule", classIds: [l.class_id], teacherId: l.teacher_id }))
    .map((l) => ({
      ...l,
      canEditSchedule: can(u, "update", { type: "schedule", classIds: [l.class_id], teacherId: l.teacher_id }),
    }));
}

export interface QuarterClass {
  cls: ClassRow;
  group: GroupInfo | null;
  professors: { id: Id; name: string }[];
  secretary: string | null;
  canEdit: boolean;
  canGenerate: boolean;
  months: { month: number; rows: { date: string; lesson: LessonRow | null }[] }[];
}

/** A escala de cada classe no trimestre: três meses, um domingo por linha (como na planilha impressa). */
export function getQuarterSchedule(u: Subject, quarter: Quarter): QuarterClass[] {
  const { from, to } = quarterRange(quarter);
  const sundays = sundaysOfQuarter(quarter);
  const lessons = listSchedule(u, { from, to });
  return listClasses(u)
    .filter((c) => can(u, "read", { type: "schedule", classIds: [c.id] }))
    .map((cls) => {
      const mine = new Map(lessons.filter((l) => l.class_id === cls.id).map((l) => [l.date, l]));
      return {
        cls,
        group: groupInfo(cls.group_id),
        professors: professorsOf(cls.id),
        secretary: staffNames(cls.id, "secretario")[0] ?? null,
        canEdit: can(u, "update", { type: "schedule", classIds: [cls.id] }),
        canGenerate: can(u, "create", { type: "schedule", classIds: [cls.id] }),
        months: quarterMonths(quarter.q).map((month) => ({
          month,
          rows: sundays
            .filter((d) => Number(d.slice(5, 7)) === month)
            .map((date) => ({ date, lesson: mine.get(date) ?? null })),
        })),
      };
    });
}

function ensureTeacher(classId: Id, teacherId: Id | null, date: string, ignoreLessonId?: Id) {
  if (teacherId === null) return;
  if (!professorsOf(classId).some((t) => t.id === teacherId))
    throw new UserError("Esse professor não leciona nesta classe.");
  const clash = db()
    .prepare(`SELECT c.name FROM lessons l JOIN classes c ON c.id=l.class_id
              WHERE l.teacher_id=? AND l.date=? AND l.status<>'cancelada' AND l.id<>? AND l.class_id<>?`)
    .get(teacherId, date, ignoreLessonId ?? -1, classId) as { name: string } | undefined;
  if (clash) throw new UserError(`Esse professor já está escalado na classe ${clash.name} nessa data.`);
}

/**
 * Cria os domingos do trimestre que ainda não existem na escala da classe.
 *  - "vazia": só cria os domingos, sem professor;
 *  - "rodizio": distribui os professores da classe em sequência (ordem em que foram cadastrados na equipe),
 *    continuando de onde a escala anterior parou;
 *  - "remanejada": marca todos os domingos como "Classe remanejada" (a classe não funciona no trimestre).
 */
export function generateQuarterSchedule(u: Subject, classId: Id, quarter: Quarter, mode: ScheduleMode): number {
  authorize(u, "create", { type: "schedule", classIds: [classId] });
  const { from, to } = quarterRange(quarter);
  const pool = mode === "rodizio" ? professorsOf(classId) : [];
  const existing = new Map(
    (db().prepare(`SELECT date, teacher_id FROM lessons WHERE class_id=? AND date BETWEEN ? AND ?`).all(classId, from, to) as {
      date: string; teacher_id: Id | null;
    }[]).map((l) => [l.date, l.teacher_id]),
  );
  // ponto de partida do rodízio: o professor seguinte ao último escalado antes do trimestre
  const prev = db()
    .prepare(`SELECT teacher_id FROM lessons WHERE class_id=? AND date<? AND teacher_id IS NOT NULL AND status<>'cancelada' ORDER BY date DESC LIMIT 1`)
    .get(classId, from) as { teacher_id: Id } | undefined;
  let idx = prev ? (pool.findIndex((t) => t.id === prev.teacher_id) + 1) % Math.max(pool.length, 1) : 0;
  if (idx < 0) idx = 0;

  const ins = db().prepare(`INSERT INTO lessons (class_id, date, teacher_id) VALUES (?, ?, ?)`);
  const insEvent = db().prepare(`INSERT INTO lessons (class_id, date, kind, event_label) VALUES (?, ?, 'evento', 'Classe remanejada')`);
  let created = 0;
  db().transaction(() => {
    for (const date of sundaysOfQuarter(quarter)) {
      if (existing.has(date)) {
        const t = existing.get(date)!;
        if (t !== null && pool.length) idx = (pool.findIndex((p) => p.id === t) + 1) % pool.length;
        continue;
      }
      if (mode === "remanejada") {
        insEvent.run(classId, date);
        created++;
        continue;
      }
      let teacher: Id | null = null;
      if (pool.length) {
        // pula quem já está escalado em outra classe no mesmo dia
        for (let tries = 0; tries < pool.length; tries++) {
          const cand = pool[(idx + tries) % pool.length];
          try {
            ensureTeacher(classId, cand.id, date);
            teacher = cand.id;
            idx = (idx + tries + 1) % pool.length;
            break;
          } catch {
            /* tenta o próximo */
          }
        }
      }
      ins.run(classId, date, teacher);
      created++;
    }
  })();
  return created;
}

/** Valor de cada linha da grade: "" (sem professor), "p:<id>" (professor) ou "e:<rótulo>" (domingo sem aula). */
export function scheduleValue(l: Pick<Lesson, "kind" | "event_label" | "teacher_id">): string {
  if (l.kind === "evento") return `e:${l.event_label ?? ""}`;
  return l.teacher_id ? `p:${l.teacher_id}` : "";
}

export function saveQuarterSchedule(u: Subject, classId: Id, entries: { lessonId: Id; value: string }[]): number {
  authorize(u, "update", { type: "schedule", classIds: [classId] });
  let changed = 0;
  db().transaction(() => {
    for (const { lessonId, value } of entries) {
      const l = getLesson(lessonId);
      if (l.class_id !== classId) throw new UserError("Aula de outra classe.");
      authorize(u, "update", res("schedule", l));
      if (value === scheduleValue(l)) continue;
      if (l.report_status === "enviada" || l.report_status === "validada")
        throw new UserError(`A aula de ${l.date.split("-").reverse().join("/")} já tem relatório enviado; devolva-o antes de alterar a escala.`);
      const hasAttendance = !!db().prepare(`SELECT 1 FROM attendance WHERE lesson_id=?`).get(lessonId);
      if (value.startsWith("e:")) {
        const label = value.slice(2).trim();
        if (!label || label.length > 60) throw new UserError("Informe o nome do evento (até 60 caracteres).");
        if (hasAttendance) throw new UserError("Esta aula já tem presença lançada; não pode virar domingo sem aula.");
        db().prepare(`UPDATE lessons SET kind='evento', event_label=?, teacher_id=NULL WHERE id=?`).run(label, lessonId);
      } else {
        const teacherId = value.startsWith("p:") ? Number(value.slice(2)) : null;
        if (value !== "" && !Number.isInteger(teacherId)) throw new UserError("Professor inválido.");
        ensureTeacher(classId, teacherId, l.date, lessonId);
        if (hasAttendance && l.teacher_id && l.teacher_id !== teacherId)
          db().prepare(`DELETE FROM attendance WHERE lesson_id=? AND person_id=?`).run(lessonId, l.teacher_id);
        db().prepare(`UPDATE lessons SET kind='aula', event_label=NULL, teacher_id=? WHERE id=?`).run(teacherId, lessonId);
      }
      changed++;
    }
  })();
  return changed;
}

// ───────────────────────────── presença
export interface SheetPerson {
  id: Id;
  name: string;
  kind: "aluno" | "professor";
  present: boolean;
  /** já tem marcação salva (false = "aguardando") */
  marked: boolean;
}

/** Quem deve preencher esta aula, em texto, para orientar a tela. */
function fillerHint(l: Lesson, secretary: string | null): string {
  if (!l.has_secretary) return "Esta classe não tem secretário designado: o professor escalado preenche.";
  if (l.secretary_absent) return `O secretário (${secretary}) foi marcado como ausente: o professor escalado preenche.`;
  return `Quem preenche é o secretário da sala (${secretary}). O professor só assume na ausência dele.`;
}

export function getAttendanceSheet(u: Subject, lessonId: Id) {
  const l = getLesson(lessonId);
  authorize(u, "read", res("attendance", l));
  const marks = new Map(
    (db().prepare(`SELECT person_id, present FROM attendance WHERE lesson_id=?`).all(lessonId) as {
      person_id: Id; present: number;
    }[]).map((m) => [m.person_id, m.present === 1]),
  );
  const alunos = db()
    .prepare(`SELECT p.id, p.name FROM enrollments e JOIN people p ON p.id=e.person_id
              WHERE e.class_id=? AND p.active=1 ORDER BY p.name`)
    .all(l.class_id) as { id: Id; name: string }[];
  // Com rodízio, o esperado em cada domingo é o professor escalado.
  const people: SheetPerson[] = [
    ...alunos.map((p) => ({ ...p, kind: "aluno" as const, present: marks.get(p.id) ?? false, marked: marks.has(p.id) })),
    ...(l.teacher_id && l.teacher_name
      ? [{ id: l.teacher_id, name: l.teacher_name, kind: "professor" as const, present: marks.get(l.teacher_id) ?? false, marked: marks.has(l.teacher_id) }]
      : []),
  ];
  const secretary = staffNames(l.class_id, "secretario")[0] ?? null;
  const editableNow = isEditableStatus(l.report_status);
  return {
    lesson: l,
    people,
    recorded: marks.size > 0,
    secretary,
    hint: l.kind === "evento" ? `Domingo sem aula: ${l.event_label}.` : fillerHint(l, secretary),
    canEdit: l.kind === "aula" && can(u, "update", res("attendance", l)),
    canEditCounts: l.kind === "aula" && can(u, "update", res("diary", l)),
    canSubmit: l.kind === "aula" && marks.size > 0 && editableNow && can(u, "create", res("report", l)),
    canMarkAbsent: l.kind === "aula" && l.has_secretary && !l.secretary_absent && editableNow && can(u, "update", res("substitution", l)),
    canUnmarkAbsent: l.kind === "aula" && l.has_secretary && l.secretary_absent && editableNow && can(u, "update", res("substitution", l)),
  };
}

export function saveAttendance(u: Subject, lessonId: Id, presentIds: Id[]): void {
  const l = getLesson(lessonId);
  authorize(u, "create", res("attendance", l));
  requireClassDay(l);
  if (l.report_status === "validada") throw new UserError("Relatório validado: peça a devolução antes de alterar a presença.");
  if (l.date > todayISO()) throw new UserError("Não é possível lançar presença de uma aula futura.");
  // O roster é decidido no servidor: ids fora da classe são ignorados.
  const roster = [
    ...(db().prepare(`SELECT person_id AS id FROM enrollments WHERE class_id=?`).all(l.class_id) as { id: Id }[]).map((r) => r.id),
    ...(l.teacher_id ? [l.teacher_id] : []),
  ];
  const present = new Set(presentIds);
  const up = db().prepare(
    `INSERT INTO attendance (lesson_id, person_id, present) VALUES (?, ?, ?)
     ON CONFLICT(lesson_id, person_id) DO UPDATE SET present=excluded.present`,
  );
  db().transaction(() => {
    for (const id of roster) up.run(lessonId, id, present.has(id) ? 1 : 0);
    db()
      .prepare(`DELETE FROM attendance WHERE lesson_id=? AND person_id NOT IN (${roster.map(() => "?").join(",") || "NULL"})`)
      .run(lessonId, ...roster);
    db().prepare(`UPDATE lessons SET status='realizada' WHERE id=?`).run(lessonId);
  })();
}

export interface AttendanceLesson extends Lesson {
  recorded: boolean;
  canFill: boolean;
}

/** Aulas (até hoje) cuja presença o usuário pode consultar; `canFill` indica se pode preencher agora. */
export function listAttendanceLessons(u: Subject, today = todayISO()): AttendanceLesson[] {
  const recorded = new Set(
    (db().prepare(`SELECT DISTINCT lesson_id FROM attendance`).all() as { lesson_id: Id }[]).map((r) => r.lesson_id),
  );
  const inView = viewFilter(u);
  return queryLessons(`WHERE l.date <= ? AND l.kind='aula' AND l.status <> 'cancelada' ORDER BY l.date DESC, c.id LIMIT 400`, today)
    .filter((l) => inView(l.class_id))
    .filter((l) => can(u, "read", res("attendance", l)))
    .map((l) => ({ ...l, recorded: recorded.has(l.id), canFill: can(u, "update", res("attendance", l)) }));
}

/** Presença do próprio aluno (única visão de presença permitida à função Aluno). */
export function myAttendance(u: Subject) {
  const rows = db()
    .prepare(`SELECT l.date, c.name AS class_name, a.present, l.class_id
                FROM attendance a JOIN lessons l ON l.id=a.lesson_id JOIN classes c ON c.id=l.class_id
               WHERE a.person_id=? AND l.report_status='validada' ORDER BY l.date DESC LIMIT 12`)
    .all(u.personId) as { date: string; class_name: string; present: number; class_id: Id }[];
  const visible = rows.filter((r) => can(u, "read", { type: "attendance", personId: u.personId, classIds: [r.class_id] }));
  const presentes = visible.filter((r) => r.present === 1).length;
  return { rows: visible, presentes, total: visible.length };
}

// ───────────────────────────── diário de classe
export function listDiary(u: Subject, today = todayISO()) {
  const inView = viewFilter(u);
  return queryLessons(`WHERE l.kind='aula' AND l.status <> 'cancelada' AND l.date <= ? ORDER BY l.date DESC, c.id LIMIT 400`, today)
    .filter((l) => inView(l.class_id))
    .filter((l) => can(u, "read", res("diary", l)))
    .map((l) => ({ ...l, canEdit: can(u, "update", res("diary", l)) }));
}

export function getDiary(u: Subject, lessonId: Id) {
  const l = getLesson(lessonId);
  authorize(u, "read", res("diary", l));
  const att = db()
    .prepare(`SELECT SUM(a.present) AS presentes, COUNT(*) AS total FROM attendance a
              JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=?
              WHERE a.lesson_id=?`)
    .get(l.class_id, lessonId) as { presentes: number | null; total: number };
  const secretary = staffNames(l.class_id, "secretario")[0] ?? null;
  return {
    lesson: l,
    alunosPresentes: att.presentes ?? 0,
    alunosTotal: att.total,
    hint: fillerHint(l, secretary),
    canEdit: l.kind === "aula" && can(u, "update", res("diary", l)),
  };
}

export function saveDiary(
  u: Subject,
  lessonId: Id,
  d: { topic: string; notes: string; visitors: number; offering_cents: number },
): void {
  const l = getLesson(lessonId);
  authorize(u, "update", res("diary", l));
  requireClassDay(l);
  if (l.report_status === "validada") throw new UserError("Relatório validado: peça a devolução antes de alterar o diário.");
  if (l.date > todayISO()) throw new UserError("O diário só pode ser preenchido a partir do dia da aula.");
  if (!Number.isInteger(d.visitors) || d.visitors < 0) throw new UserError("Número de visitantes inválido.");
  if (!Number.isInteger(d.offering_cents) || d.offering_cents < 0) throw new UserError("Valor da oferta inválido.");
  db()
    .prepare(`UPDATE lessons SET topic=?, notes=?, visitors=?, offering_cents=? WHERE id=?`)
    .run(d.topic.trim() || null, d.notes.trim() || null, d.visitors, d.offering_cents, lessonId);
}

// ───────────────────────────── substituição, envio e validação do relatório
/** Marca (ou desmarca) o secretário como ausente; com isso o professor escalado passa a poder preencher. */
export function setSecretaryAbsent(u: Subject, lessonId: Id, absent: boolean): void {
  const l = getLesson(lessonId);
  authorize(u, "update", res("substitution", l));
  requireClassDay(l);
  if (!l.has_secretary) throw new UserError("Esta classe não tem secretário designado; o professor já pode preencher.");
  if (!isEditableStatus(l.report_status)) throw new UserError("O relatório desta aula já foi enviado.");
  db().prepare(`UPDATE lessons SET secretary_absent=? WHERE id=?`).run(absent ? 1 : 0, lessonId);
}

/** Envia o relatório da aula (presença + diário) para a validação da secretaria geral. */
export function submitReport(u: Subject, lessonId: Id): void {
  const l = getLesson(lessonId);
  authorize(u, "create", res("report", l));
  requireClassDay(l);
  if (!isEditableStatus(l.report_status))
    throw new UserError(l.report_status === "validada" ? "Este relatório já foi validado." : "Este relatório já foi enviado.");
  if (l.date > todayISO()) throw new UserError("Não é possível enviar o relatório de uma aula futura.");
  if (!db().prepare(`SELECT 1 FROM attendance WHERE lesson_id=?`).get(lessonId))
    throw new UserError("Lance a presença antes de enviar o relatório.");
  db()
    .prepare(`UPDATE lessons SET report_status='enviada', status='realizada', submitted_by=?, submitted_at=?, return_note=NULL WHERE id=?`)
    .run(u.personId, nowISO(), lessonId);
  // avisa a secretaria geral da congregação
  const sec = (db()
    .prepare(`SELECT u.id FROM users u JOIN people p ON p.id=u.person_id WHERE u.role='secretaria' AND p.congregation_id=(SELECT congregation_id FROM classes WHERE id=?)`)
    .all(l.class_id) as { id: Id }[]).map((r) => r.id);
  notifyUsers(sec, { title: `Relatório enviado: ${l.class_name}`, body: `Aula de ${l.date.split("-").reverse().join("/")} aguardando validação.`, url: `/validacao/${lessonId}` });
}

export function validateReport(u: Subject, lessonId: Id): void {
  const l = getLesson(lessonId);
  authorize(u, "update", res("report", l));
  if (l.report_status !== "enviada") throw new UserError("Só é possível validar um relatório enviado.");
  // Separação de funções: quem enviou não valida o próprio relatório (exceto a superintendência).
  if (l.submitted_by === u.personId && u.role !== "superintendente")
    throw new UserError("Quem enviou o relatório não pode validá-lo.");
  db()
    .prepare(`UPDATE lessons SET report_status='validada', validated_by=?, validated_at=? WHERE id=?`)
    .run(u.personId, nowISO(), lessonId);
}

/** Devolve o relatório para correção. Reabrir um relatório já validado é exclusivo da superintendência. */
export function returnReport(u: Subject, lessonId: Id, note: string): void {
  const l = getLesson(lessonId);
  authorize(u, "update", res("report", l));
  if (l.report_status === "validada") authorize(u, "delete", res("report", l));
  else if (l.report_status !== "enviada") throw new UserError("Só é possível devolver um relatório enviado.");
  if (note.trim().length < 3) throw new UserError("Explique o que precisa ser corrigido.");
  db()
    .prepare(`UPDATE lessons SET report_status='devolvida', return_note=?, validated_by=NULL, validated_at=NULL WHERE id=?`)
    .run(note.trim(), lessonId);
  // avisa quem enviou (ou o secretário da sala)
  const to = (db()
    .prepare(`SELECT u.id FROM users u WHERE u.person_id IN (SELECT ? UNION SELECT person_id FROM class_staff WHERE class_id=? AND function='secretario')`)
    .all(l.submitted_by ?? -1, l.class_id) as { id: Id }[]).map((r) => r.id);
  notifyUsers(to, { title: `Relatório devolvido: ${l.class_name}`, body: note.trim().slice(0, 140), url: `/presenca/${lessonId}` });
}

export interface QueueRow extends Lesson {
  secretary_name: string | null;
  submitted_by_name: string | null;
}

/** Fila da secretaria geral: o que aguarda validação, o que voltou para correção e o que nem foi enviado. */
export function listValidationQueue(u: Subject, today = todayISO()) {
  authorize(u, "update", { type: "report" });
  const inView = viewFilter(u);
  const rows = queryLessons(
    `WHERE l.kind='aula' AND l.status <> 'cancelada' AND l.date <= ? AND l.report_status <> 'validada'
     ORDER BY l.date, c.id LIMIT 2000`,
    today,
  )
    .filter((l) => inView(l.class_id))
    .filter((l) => can(u, "read", res("report", l)))
    .map((l) => ({
      ...l,
      secretary_name: staffNames(l.class_id, "secretario")[0] ?? null,
      submitted_by_name: l.submitted_by
        ? ((db().prepare(`SELECT name FROM people WHERE id=?`).get(l.submitted_by) as { name: string } | undefined)?.name ?? null)
        : null,
    })) as QueueRow[];
  return {
    awaiting: rows.filter((r) => r.report_status === "enviada"),
    returned: rows.filter((r) => r.report_status === "devolvida"),
    missing: rows.filter((r) => r.report_status === "pendente"),
  };
}

export function getReportReview(u: Subject, lessonId: Id) {
  const l = getLesson(lessonId);
  authorize(u, "read", res("report", l));
  const sheet = getAttendanceSheetUnchecked(l);
  const name = (id: Id | null) =>
    id ? ((db().prepare(`SELECT name FROM people WHERE id=?`).get(id) as { name: string } | undefined)?.name ?? null) : null;
  return {
    lesson: l,
    people: sheet,
    alunosPresentes: sheet.filter((p) => p.kind === "aluno" && p.present).length,
    alunosTotal: sheet.filter((p) => p.kind === "aluno").length,
    secretary: staffNames(l.class_id, "secretario")[0] ?? null,
    submittedBy: name(l.submitted_by),
    validatedBy: name(l.validated_by),
    canValidate:
      l.report_status === "enviada" && can(u, "update", res("report", l)) &&
      (l.submitted_by !== u.personId || u.role === "superintendente"),
    canReturn: can(u, "update", res("report", l)) && (l.report_status === "enviada" ||
      (l.report_status === "validada" && can(u, "delete", res("report", l)))),
  };
}

function getAttendanceSheetUnchecked(l: Lesson): SheetPerson[] {
  const marks = new Map(
    (db().prepare(`SELECT person_id, present FROM attendance WHERE lesson_id=?`).all(l.id) as { person_id: Id; present: number }[])
      .map((m) => [m.person_id, m.present === 1]),
  );
  const alunos = db()
    .prepare(`SELECT p.id, p.name FROM enrollments e JOIN people p ON p.id=e.person_id WHERE e.class_id=? AND p.active=1 ORDER BY p.name`)
    .all(l.class_id) as { id: Id; name: string }[];
  return [
    ...alunos.map((p) => ({ ...p, kind: "aluno" as const, present: marks.get(p.id) ?? false, marked: marks.has(p.id) })),
    ...(l.teacher_id && l.teacher_name
      ? [{ id: l.teacher_id, name: l.teacher_name, kind: "professor" as const, present: marks.get(l.teacher_id) ?? false, marked: marks.has(l.teacher_id) }]
      : []),
  ];
}

// ───────────────────────────── relatório consolidado da EBD (por trimestre)
export interface Tally {
  aulasProgramadas: number;
  aulasValidadas: number;
  pendencias: number;
  eventos: number;
  alunosPresentes: number;
  alunosRegistros: number;
  professoresPresentes: number;
  professoresRegistros: number;
  visitantes: number;
  ofertaCents: number;
}

const emptyTally = (): Tally => ({
  aulasProgramadas: 0, aulasValidadas: 0, pendencias: 0, eventos: 0, alunosPresentes: 0, alunosRegistros: 0,
  professoresPresentes: 0, professoresRegistros: 0, visitantes: 0, ofertaCents: 0,
});

const addTally = (a: Tally, b: Tally): Tally => {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof Tally)[]) out[k] += b[k];
  return out;
};

export const frequency = (t: Tally): number | null =>
  t.alunosRegistros ? Math.round((t.alunosPresentes / t.alunosRegistros) * 1000) / 10 : null;

export interface ConsolidatedClass {
  cls: ClassRow;
  matriculados: number;
  total: Tally;
  months: { month: number; tally: Tally }[];
}

export interface Consolidated {
  quarter: Quarter;
  classes: ConsolidatedClass[];
  total: Tally;
  months: { month: number; tally: Tally }[];
}

/** Só as aulas VALIDADAS entram nos números; o que ainda não foi validado aparece como pendência. */
export function getConsolidated(u: Subject, quarter: Quarter, today = todayISO()): Consolidated {
  const { from, to } = quarterRange(quarter);
  const months = quarterMonths(quarter.q);
  const classes = listClasses(u).filter((c) => can(u, "read", { type: "consolidated", classIds: [c.id] }));
  if (classes.length === 0 && !can(u, "read", { type: "consolidated" })) {
    throw new ForbiddenError();
  }
  const VALID = `l.kind='aula' AND l.status<>'cancelada' AND l.report_status='validada' AND l.date BETWEEN ? AND ?`;

  const counts = db()
    .prepare(
      `SELECT class_id, CAST(substr(date,6,2) AS INTEGER) AS m,
              SUM(CASE WHEN kind='aula' AND status<>'cancelada' THEN 1 ELSE 0 END) AS programadas,
              SUM(CASE WHEN kind='aula' AND status<>'cancelada' AND report_status='validada' THEN 1 ELSE 0 END) AS validadas,
              SUM(CASE WHEN kind='aula' AND status<>'cancelada' AND report_status<>'validada' AND date<=? THEN 1 ELSE 0 END) AS pendencias,
              SUM(CASE WHEN kind='evento' THEN 1 ELSE 0 END) AS eventos
         FROM lessons WHERE date BETWEEN ? AND ? GROUP BY class_id, m`,
    )
    .all(today, from, to) as { class_id: Id; m: number; programadas: number; validadas: number; pendencias: number; eventos: number }[];

  const money = db()
    .prepare(
      `SELECT l.class_id, CAST(substr(l.date,6,2) AS INTEGER) AS m, SUM(l.visitors) AS visitantes, SUM(l.offering_cents) AS oferta
         FROM lessons l WHERE ${VALID} GROUP BY l.class_id, m`,
    )
    .all(from, to) as { class_id: Id; m: number; visitantes: number; oferta: number }[];

  const att = db()
    .prepare(
      `SELECT l.class_id, CAST(substr(l.date,6,2) AS INTEGER) AS m,
              SUM(CASE WHEN e.person_id IS NOT NULL THEN a.present ELSE 0 END) AS al_pres,
              SUM(CASE WHEN e.person_id IS NOT NULL THEN 1 ELSE 0 END) AS al_reg,
              SUM(CASE WHEN a.person_id = l.teacher_id THEN a.present ELSE 0 END) AS pr_pres,
              SUM(CASE WHEN a.person_id = l.teacher_id THEN 1 ELSE 0 END) AS pr_reg
         FROM attendance a JOIN lessons l ON l.id = a.lesson_id
         LEFT JOIN enrollments e ON e.class_id = l.class_id AND e.person_id = a.person_id
        WHERE ${VALID} GROUP BY l.class_id, m`,
    )
    .all(from, to) as { class_id: Id; m: number; al_pres: number; al_reg: number; pr_pres: number; pr_reg: number }[];

  const out: ConsolidatedClass[] = classes.map((cls) => {
    const monthly = months.map((month) => {
      const t = emptyTally();
      const c = counts.find((x) => x.class_id === cls.id && x.m === month);
      const mo = money.find((x) => x.class_id === cls.id && x.m === month);
      const a = att.find((x) => x.class_id === cls.id && x.m === month);
      if (c) Object.assign(t, { aulasProgramadas: c.programadas, aulasValidadas: c.validadas, pendencias: c.pendencias, eventos: c.eventos });
      if (mo) Object.assign(t, { visitantes: mo.visitantes ?? 0, ofertaCents: mo.oferta ?? 0 });
      if (a) Object.assign(t, { alunosPresentes: a.al_pres ?? 0, alunosRegistros: a.al_reg ?? 0, professoresPresentes: a.pr_pres ?? 0, professoresRegistros: a.pr_reg ?? 0 });
      return { month, tally: t };
    });
    return {
      cls,
      matriculados: (db().prepare(`SELECT COUNT(*) n FROM enrollments e JOIN people p ON p.id=e.person_id WHERE e.class_id=? AND p.active=1`).get(cls.id) as { n: number }).n,
      total: monthly.reduce((acc, m) => addTally(acc, m.tally), emptyTally()),
      months: monthly,
    };
  });

  return {
    quarter,
    classes: out,
    total: out.reduce((acc, c) => addTally(acc, c.total), emptyTally()),
    months: months.map((month) => ({
      month,
      tally: out.reduce((acc, c) => addTally(acc, c.months.find((m) => m.month === month)!.tally), emptyTally()),
    })),
  };
}

export interface PersonFrequency {
  id: Id;
  name: string;
  presentes: number;
  total: number;
  pct: number | null;
}

/** Frequência individual no trimestre (apenas aulas validadas): alunos e professores da classe. */
export function getPersonFrequency(u: Subject, classId: Id, quarter: Quarter) {
  authorize(u, "read", { type: "consolidated", classIds: [classId] });
  const { from, to } = quarterRange(quarter);
  const pct = (p: number, t: number) => (t ? Math.round((p / t) * 1000) / 10 : null);
  const alunos = (
    db()
      .prepare(
        `SELECT p.id, p.name, COALESCE(SUM(a.present),0) AS presentes, COUNT(a.lesson_id) AS total
           FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1
           LEFT JOIN (SELECT a.* FROM attendance a JOIN lessons l ON l.id=a.lesson_id
                       WHERE l.class_id=? AND l.kind='aula' AND l.status<>'cancelada'
                         AND l.report_status='validada' AND l.date BETWEEN ? AND ?) a ON a.person_id=e.person_id
          WHERE e.class_id=? GROUP BY p.id ORDER BY p.name`,
      )
      .all(classId, from, to, classId) as Omit<PersonFrequency, "pct">[]
  ).map((r) => ({ ...r, pct: pct(r.presentes, r.total) }));
  const professores = (
    db()
      .prepare(
        `SELECT p.id, p.name, COALESCE(SUM(a.present),0) AS presentes, COUNT(l.id) AS total
           FROM class_staff s JOIN people p ON p.id=s.person_id AND p.active=1
           LEFT JOIN lessons l ON l.teacher_id=p.id AND l.class_id=s.class_id AND l.kind='aula' AND l.status<>'cancelada'
                              AND l.report_status='validada' AND l.date BETWEEN ? AND ?
           LEFT JOIN attendance a ON a.lesson_id=l.id AND a.person_id=p.id
          WHERE s.class_id=? AND s.function='professor' GROUP BY p.id ORDER BY MIN(s.rowid)`,
      )
      .all(from, to, classId) as Omit<PersonFrequency, "pct">[]
  ).map((r) => ({ ...r, pct: pct(r.presentes, r.total) }));
  return { alunos, professores };
}

// ───────────────────────────── material didático e pagamentos
export interface OrderRow {
  congregation_id: Id;
  id: Id;
  material_title: string;
  period: string | null;
  person_id: Id;
  person_name: string;
  class_id: Id | null;
  class_name: string | null;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  canPay: boolean;
  payments: { id: Id; amount_cents: number; paid_at: string; method: string }[];
}

export function listOrders(u: Subject): OrderRow[] {
  const rows = db()
    .prepare(
      `SELECT o.id, m.title AS material_title, m.period, o.person_id, p.name AS person_name, o.class_id,
              c.name AS class_name, o.price_cents, p.congregation_id,
              COALESCE((SELECT SUM(amount_cents) FROM payments WHERE order_id=o.id), 0) AS paid_cents
         FROM material_orders o
         JOIN materials m ON m.id=o.material_id
         JOIN people p ON p.id=o.person_id
         LEFT JOIN classes c ON c.id=o.class_id
        ORDER BY c.id, p.name`,
    )
    .all() as Omit<OrderRow, "balance_cents" | "canPay" | "payments">[];
  const pays = db().prepare(`SELECT id, order_id, amount_cents, paid_at, method FROM payments ORDER BY paid_at, id`).all() as {
    id: Id; order_id: Id; amount_cents: number; paid_at: string; method: string;
  }[];
  const inView = viewFilter(u);
  return rows
    .filter((o) => (o.class_id ? inView(o.class_id) : u.view == null || o.congregation_id === u.view))
    .filter((o) =>
      can(u, "read", { type: "material_order", classIds: o.class_id ? [o.class_id] : [], personId: o.person_id, congregationId: o.congregation_id }),
    )
    .map((o) => ({
      ...o,
      balance_cents: o.price_cents - o.paid_cents,
      canPay: can(u, "create", { type: "payment", classIds: o.class_id ? [o.class_id] : [], personId: o.person_id }),
      payments: pays.filter((p) => p.order_id === o.id).filter(() =>
        can(u, "read", { type: "payment", classIds: o.class_id ? [o.class_id] : [], personId: o.person_id }),
      ),
    }));
}

export function registerPayment(u: Subject, orderId: Id, amountCents: number, method: string, date: string): void {
  const o = db().prepare(`SELECT id, person_id, class_id, price_cents FROM material_orders WHERE id=?`).get(orderId) as
    | { id: Id; person_id: Id; class_id: Id | null; price_cents: number }
    | undefined;
  if (!o) throw new UserError("Pedido não encontrado.");
  authorize(u, "create", { type: "payment", classIds: o.class_id ? [o.class_id] : [], personId: o.person_id });
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new UserError("Valor inválido.");
  if (!isISODate(date)) throw new UserError("Data inválida.");
  if (!["dinheiro", "pix", "cartão", "transferência"].includes(method)) throw new UserError("Forma de pagamento inválida.");
  const paid = (db().prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE order_id=?`).get(orderId) as { s: number }).s;
  if (paid + amountCents > o.price_cents) throw new UserError("O pagamento ultrapassa o valor da revista.");
  db()
    .prepare(`INSERT INTO payments (order_id, amount_cents, paid_at, method, received_by) VALUES (?, ?, ?, ?, ?)`)
    .run(orderId, amountCents, date, method, u.personId);
}

/** Cadastra a revista e gera o pedido para cada aluno matriculado na classe. */
export function createMaterial(
  u: Subject,
  d: { title: string; period: string; priceCents: number; classId: Id },
): number {
  authorize(u, "create", { type: "material" });
  authorize(u, "create", { type: "material_order", classIds: [d.classId] });
  if (!d.title.trim()) throw new UserError("Informe o título da revista.");
  if (!Number.isInteger(d.priceCents) || d.priceCents <= 0) throw new UserError("Preço inválido.");
  return db().transaction(() => {
    const matId = Number(
      db().prepare(`INSERT INTO materials (title, period, price_cents) VALUES (?, ?, ?)`).run(
        d.title.trim(), d.period.trim() || null, d.priceCents,
      ).lastInsertRowid,
    );
    const students = db()
      .prepare(`SELECT e.person_id FROM enrollments e JOIN people p ON p.id=e.person_id WHERE e.class_id=? AND p.active=1`)
      .all(d.classId) as { person_id: Id }[];
    const ins = db().prepare(
      `INSERT INTO material_orders (material_id, person_id, class_id, price_cents) VALUES (?, ?, ?, ?)`,
    );
    for (const s of students) ins.run(matId, s.person_id, d.classId, d.priceCents);
    return students.length;
  })();
}

// ───────────────────────────── usuários (somente superintendência)
export interface UserRow {
  id: Id;
  email: string;
  role: Role;
  person_id: Id;
  name: string;
  congregation_id: Id;
  congregation: string;
}

export function listUsers(u: Subject): UserRow[] {
  authorize(u, "read", { type: "user" });
  return (db()
    .prepare(`SELECT u.id, u.email, u.role, u.person_id, p.name, p.congregation_id, c.name AS congregation
                FROM users u JOIN people p ON p.id=u.person_id JOIN congregations c ON c.id=p.congregation_id ORDER BY p.name`)
    .all() as UserRow[])
    .filter((x) => u.view == null || x.congregation_id === u.view)
    .filter((x) => can(u, "read", { type: "user", congregationId: x.congregation_id }));
}

/** Funções que só o Pastor/Presidente pode conceder ou retirar (alcançam várias congregações). */
const GLOBAL_ROLES: Role[] = ["pastor", "supervisor"];

function guardRoleChange(u: Subject, from: Role | null, to: Role) {
  if ((GLOBAL_ROLES.includes(to) || (from && GLOBAL_ROLES.includes(from))) && u.role !== "pastor")
    throw new ForbiddenError("Somente o Pastor/Presidente concede ou altera as funções de Pastor e Supervisor regional.");
}

const personCongregation = (personId: Id): Id | null =>
  (db().prepare(`SELECT congregation_id FROM people WHERE id=?`).get(personId) as { congregation_id: Id } | undefined)?.congregation_id ?? null;

export function createUser(u: Subject, d: { personId: Id; email: string; password: string; role: Role }): void {
  const cong = personCongregation(d.personId);
  if (cong === null) throw new UserError("Pessoa não encontrada.");
  authorize(u, "create", { type: "user", congregationId: cong });
  guardRoleChange(u, null, d.role);
  if (!/^\S+@\S+\.\S+$/.test(d.email)) throw new UserError("E-mail inválido.");
  if (d.password.length < 8) throw new UserError("A senha deve ter pelo menos 8 caracteres.");
  try {
    db()
      .prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (?, ?, ?, ?)`)
      .run(d.personId, d.email.trim().toLowerCase(), hashPassword(d.password), d.role);
  } catch {
    throw new UserError("Já existe um usuário com esse e-mail.");
  }
}

export function changeUserRole(u: Subject, userId: Id, role: Role): void {
  const target = db().prepare(`SELECT u.id, u.role, p.congregation_id FROM users u JOIN people p ON p.id=u.person_id WHERE u.id=?`).get(userId) as
    | { id: Id; role: Role; congregation_id: Id } | undefined;
  if (!target) throw new UserError("Usuário não encontrado.");
  authorize(u, "update", { type: "user", congregationId: target.congregation_id });
  guardRoleChange(u, target.role, role);
  const admins = ["pastor", "superintendente"];
  if (admins.includes(target.role) && !admins.includes(role)) {
    const n = (db().prepare(`SELECT COUNT(*) n FROM users WHERE role IN ('pastor','superintendente')`).get() as { n: number }).n;
    if (n <= 1) throw new UserError("Não é possível rebaixar o único superintendente/administrador.");
  }
  db().prepare(`UPDATE users SET role=? WHERE id=?`).run(role, userId);
}

// ───────────────────────────── painel inicial
export function dashboard(u: Subject, today = todayISO()) {
  const upcoming = listSchedule(u, { from: today }).filter((l) => l.status !== "cancelada").slice(0, 6);
  const birthdays = listBirthdays(u, today).filter((b) => {
    const [, tm, td] = today.split("-").map(Number);
    const days = (b.month - tm) * 31 + (b.day - td);
    return days >= 0 && days <= 7;
  });
  const orders = listOrders(u);
  const isAluno = u.role === "aluno";
  const showFinance = ["superintendente", "secretaria", "coordenador"].includes(u.role);
  const pending = orders.filter((o) => o.balance_cents > 0);
  const toFill = listAttendanceLessons(u, today).filter((l) => l.canFill && isEditableStatus(l.report_status));
  const toValidate = can(u, "update", { type: "report" })
    ? (db().prepare(`SELECT COUNT(*) n FROM lessons WHERE report_status='enviada'`).get() as { n: number }).n
    : null;
  return {
    upcoming,
    birthdays,
    toFill: toFill.slice(0, 6),
    toFillCount: toFill.length,
    toValidate,
    finance: showFinance
      ? { pendingCount: pending.length, pendingCents: pending.reduce((a, o) => a + o.balance_cents, 0) }
      : null,
    mine: isAluno ? myAttendance(u) : null,
    myOrders: isAluno ? orders : [],
  };
}

export { ForbiddenError, isSunday };

// ───────────────────────────── painel administrativo (BI)
export interface BITrend {
  label: string;
  quarter: Quarter;
  frequencia: number | null;
  ofertaCents: number;
  visitantes: number;
  validadas: number;
  programadas: number;
}

export interface BIGroup {
  id: Id | null;
  name: string;
  coordinator: string | null;
  classes: number;
  matriculados: number;
  total: Tally;
}

export interface BITeacher {
  id: Id;
  name: string;
  classes: string;
  escalado: number;
  presente: number;
  registrado: number;
}

export interface BILowStudent {
  id: Id;
  name: string;
  class_name: string;
  presentes: number;
  total: number;
  pct: number;
}

/**
 * Indicadores do painel. O escopo é o mesmo do relatório consolidado: superintendência e secretaria geral
 * veem toda a EBD; o coordenador, apenas as classes da sua Escala. Quem não lê o consolidado recebe 403.
 */
export function getBI(u: Subject, quarter: Quarter, today = todayISO(), lowThreshold = 50) {
  const current = getConsolidated(u, quarter, today); // autoriza
  const classIds = current.classes.map((c) => c.cls.id);
  const inList = classIds.length ? classIds.join(",") : "NULL"; // ids inteiros vindos do banco
  const { from, to } = quarterRange(quarter);

  // tendência: os 4 últimos trimestres até o selecionado
  const quarters: Quarter[] = [quarter];
  for (let i = 0; i < 3; i++) quarters.unshift(shiftQuarter(quarters[0], -1));
  const trend: BITrend[] = quarters.map((q) => {
    const c = q === quarter ? current : getConsolidated(u, q, today);
    return {
      label: quarterLabel(q), quarter: q, frequencia: frequency(c.total), ofertaCents: c.total.ofertaCents,
      visitantes: c.total.visitantes, validadas: c.total.aulasValidadas, programadas: c.total.aulasProgramadas,
    };
  });

  // por Escala
  const groups = new Map<string, BIGroup>();
  for (const c of current.classes) {
    const g = groupInfo(c.cls.group_id);
    const key = String(c.cls.group_id);
    const cur = groups.get(key) ?? {
      id: c.cls.group_id, name: g?.name ?? "Sem escala", coordinator: g?.coordinator ?? null, classes: 0, matriculados: 0, total: emptyTally(),
    };
    cur.classes++;
    cur.matriculados += c.matriculados;
    cur.total = addTally(cur.total, c.total);
    groups.set(key, cur);
  }

  // situação dos relatórios (aulas já ocorridas no trimestre)
  const status = Object.fromEntries(
    (db()
      .prepare(`SELECT report_status AS s, COUNT(*) AS n FROM lessons
                 WHERE class_id IN (${inList}) AND kind='aula' AND status<>'cancelada' AND date BETWEEN ? AND ? AND date<=?
                 GROUP BY report_status`)
      .all(from, to, today) as { s: ReportStatus; n: number }[]).map((r) => [r.s, r.n]),
  ) as Partial<Record<ReportStatus, number>>;
  const reports = { pendente: status.pendente ?? 0, enviada: status.enviada ?? 0, devolvida: status.devolvida ?? 0, validada: status.validada ?? 0 };

  // professores: aulas escaladas no trimestre e presença registrada nos relatórios validados
  const teachers = db()
    .prepare(
      `SELECT p.id, p.name, GROUP_CONCAT(DISTINCT c.name) AS classes,
              COUNT(l.id) AS escalado,
              SUM(CASE WHEN l.report_status='validada' AND a.present=1 THEN 1 ELSE 0 END) AS presente,
              SUM(CASE WHEN l.report_status='validada' AND a.person_id IS NOT NULL THEN 1 ELSE 0 END) AS registrado
         FROM lessons l JOIN people p ON p.id=l.teacher_id JOIN classes c ON c.id=l.class_id
         LEFT JOIN attendance a ON a.lesson_id=l.id AND a.person_id=l.teacher_id
        WHERE l.class_id IN (${inList}) AND l.kind='aula' AND l.status<>'cancelada' AND l.date BETWEEN ? AND ?
        GROUP BY p.id ORDER BY escalado DESC, p.name`,
    )
    .all(from, to) as BITeacher[];

  // escala: domingos futuros (até 5 semanas) sem professor
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 35);
  const gaps = queryLessons(
    `WHERE l.class_id IN (${inList}) AND l.kind='aula' AND l.status<>'cancelada' AND l.teacher_id IS NULL
       AND l.date BETWEEN ? AND ? ORDER BY l.date, c.id`,
    today, horizon.toISOString().slice(0, 10),
  );

  // alunos com frequência baixa (acompanhamento pastoral)
  const low: BILowStudent[] = [];
  for (const c of current.classes) {
    for (const a of getPersonFrequency(u, c.cls.id, quarter).alunos) {
      if (a.total >= 2 && a.pct !== null && a.pct < lowThreshold)
        low.push({ id: a.id, name: a.name, class_name: c.cls.name, presentes: a.presentes, total: a.total, pct: a.pct });
    }
  }
  low.sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));

  // financeiro das revistas (só para quem pode ver os pedidos)
  const orders = can(u, "read", { type: "material_order" }) || classIds.some((id) => can(u, "read", { type: "material_order", classIds: [id] }))
    ? listOrders(u)
    : null;
  const finance = orders && {
    pedidos: orders.length,
    totalCents: orders.reduce((n, o) => n + o.price_cents, 0),
    pagoCents: orders.reduce((n, o) => n + o.paid_cents, 0),
    abertoCents: orders.reduce((n, o) => n + o.balance_cents, 0),
    quitadas: orders.filter((o) => o.balance_cents === 0).length,
    porClasse: [...orders.reduce((m, o) => {
      const k = o.class_name ?? "Sem classe";
      const cur = m.get(k) ?? { name: k, totalCents: 0, pagoCents: 0 };
      cur.totalCents += o.price_cents;
      cur.pagoCents += o.paid_cents;
      return m.set(k, cur);
    }, new Map<string, { name: string; totalCents: number; pagoCents: number }>()).values()],
  };

  const month = Number(today.slice(5, 7));
  const birthdaysThisMonth = listBirthdays(u, today).filter((b) => b.month === month).length;
  const people = {
    matriculados: current.classes.reduce((n, c) => n + c.matriculados, 0),
    professores: (db().prepare(`SELECT COUNT(DISTINCT person_id) n FROM class_staff WHERE function='professor' AND class_id IN (${inList})`).get() as { n: number }).n,
    secretarios: (db().prepare(`SELECT COUNT(DISTINCT person_id) n FROM class_staff WHERE function='secretario' AND class_id IN (${inList})`).get() as { n: number }).n,
    salasSemSecretario: classIds.filter((id) => staffNames(id, "secretario").length === 0).length,
    birthdaysThisMonth,
  };

  const mediaPorAula = current.total.aulasValidadas ? Math.round(current.total.alunosPresentes / current.total.aulasValidadas) : null;

  const absentees = listAbsentees(u, 3, today);
  return { quarter, current, trend, groups: [...groups.values()], reports, teachers, gaps, low, finance, people, mediaPorAula, absentees };
}

/** Controle de acesso (somente superintendência): usuários por função. */
export function usersByRole(u: Subject) {
  const users = listUsers(u);
  return users.reduce((m, x) => ({ ...m, [x.role]: (m[x.role] ?? 0) + 1 }), {} as Partial<Record<Role, number>>);
}

// ───────────────────────────── redefinição de senha (superintendência)
export function resetUserPassword(u: Subject, userId: Id, password: string): void {
  const t = db().prepare(`SELECT u.role, p.congregation_id FROM users u JOIN people p ON p.id=u.person_id WHERE u.id=?`).get(userId) as
    | { role: Role; congregation_id: Id } | undefined;
  if (!t) throw new UserError("Usuário não encontrado.");
  authorize(u, "update", { type: "user", congregationId: t.congregation_id });
  if (GLOBAL_ROLES.includes(t.role) && u.role !== "pastor") throw new ForbiddenError();
  if (password.length < 8) throw new UserError("A nova senha precisa ter ao menos 8 caracteres.");
  const r = db().prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hashPassword(password), userId);
  if (r.changes === 0) throw new UserError("Usuário não encontrado.");
}

// ───────────────────────────── ausentes (acompanhamento pastoral)
export interface Absentee {
  id: Id;
  name: string;
  class_id: Id;
  class_name: string;
  faltas: number; // faltas seguidas nas últimas aulas com chamada
  lastPresent: string | null;
  phone: string | null; // só com permissão de ver contatos
  guardian_name: string | null;
}

/**
 * Alunos que faltaram às últimas `n` aulas da sua classe em que houve chamada (lançada, não necessariamente validada,
 * para que o acompanhamento seja rápido). Escopo: quem pode ver a presença da classe.
 */
export function listAbsentees(u: Subject, n = 3, today = todayISO()): Absentee[] {
  const out: Absentee[] = [];
  for (const cls of listClasses(u)) {
    if (!can(u, "read", { type: "attendance", classIds: [cls.id] })) continue;
    const lessons = (db()
      .prepare(`SELECT l.id FROM lessons l WHERE l.class_id=? AND l.kind='aula' AND l.status<>'cancelada' AND l.date<=?
                  AND EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_id=l.id) ORDER BY l.date DESC LIMIT ?`)
      .all(cls.id, today, n) as { id: Id }[]).map((r) => r.id);
    if (lessons.length < n) continue;
    const ph = lessons.map(() => "?").join(",");
    const rows = db()
      .prepare(`SELECT p.id, p.name, p.phone, p.guardian_name,
                       (SELECT MAX(l2.date) FROM attendance a2 JOIN lessons l2 ON l2.id=a2.lesson_id
                         WHERE a2.person_id=p.id AND a2.present=1 AND l2.class_id=?) AS lastPresent
                  FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1
                 WHERE e.class_id=?
                   AND (SELECT COUNT(*) FROM attendance a WHERE a.person_id=p.id AND a.present=1 AND a.lesson_id IN (${ph}))=0
                 ORDER BY p.name`)
      .all(cls.id, cls.id, ...lessons) as { id: Id; name: string; phone: string | null; guardian_name: string | null; lastPresent: string | null }[];
    for (const r of rows) {
      const sensitive = can(u, "read_sensitive", { type: "person", personId: r.id, classIds: [cls.id] });
      out.push({
        id: r.id, name: r.name, class_id: cls.id, class_name: cls.name, faltas: n, lastPresent: r.lastPresent,
        phone: sensitive ? r.phone : null, guardian_name: sensitive ? r.guardian_name : null,
      });
    }
  }
  return out;
}

// ───────────────────────────── lista de chamada em branco (frequência manual)
export function getBlankRoster(u: Subject, quarter: Quarter) {
  const { from, to } = quarterRange(quarter);
  return listClasses(u)
    .filter((c) => can(u, "read", { type: "attendance", classIds: [c.id] }))
    .map((cls) => {
      const lessons = db()
        .prepare(`SELECT l.date, l.kind, l.event_label, p.name AS teacher FROM lessons l LEFT JOIN people p ON p.id=l.teacher_id
                   WHERE l.class_id=? AND l.date BETWEEN ? AND ? ORDER BY l.date`)
        .all(cls.id, from, to) as { date: string; kind: string; event_label: string | null; teacher: string | null }[];
      const byDate = new Map(lessons.map((l) => [l.date, l]));
      return {
        cls,
        group: groupInfo(cls.group_id),
        secretary: staffNames(cls.id, "secretario")[0] ?? null,
        dates: sundaysOfQuarter(quarter).map((date) => ({ date, lesson: byDate.get(date) ?? null })),
        students: db()
          .prepare(`SELECT p.id, p.name FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 WHERE e.class_id=? ORDER BY p.name`)
          .all(cls.id) as { id: Id; name: string }[],
      };
    });
}

// ───────────────────────────── ficha da pessoa
export function getPersonFile(u: Subject, personId: Id, today = todayISO()) {
  const p = rawPeople().find((x) => x.id === personId);
  if (!p) return null;
  authorize(u, "read", personRes("person", p));
  const sensitive = can(u, "read_sensitive", personRes("person", p));
  const names = new Map(allClasses().map((c) => [c.id, c.name]));

  // presença: só das classes em que o usuário pode ver a presença desta pessoa
  const att = (db()
    .prepare(`SELECT l.id, l.date, l.class_id, l.report_status, a.present, l.teacher_id
                FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE a.person_id=? AND l.date<=? ORDER BY l.date DESC`)
    .all(personId, today) as { id: Id; date: string; class_id: Id; report_status: ReportStatus; present: number; teacher_id: Id | null }[])
    .filter((r) => can(u, "read", { type: "attendance", personId, classIds: [r.class_id] }));
  const quarters = new Map<string, { label: string; presentes: number; total: number }>();
  for (const r of att.filter((x) => x.report_status === "validada")) {
    const q = { year: Number(r.date.slice(0, 4)), q: (Math.floor((Number(r.date.slice(5, 7)) - 1) / 3) + 1) as Quarter["q"] };
    const k = `${q.year}-${q.q}`;
    const cur = quarters.get(k) ?? { label: quarterLabel(q), presentes: 0, total: 0 };
    cur.total++;
    cur.presentes += r.present;
    quarters.set(k, cur);
  }
  const orders = listOrders(u).filter((o) => o.person_id === personId);
  const birthday = listBirthdays(u, today).find((b) => b.id === personId) ?? null;
  return {
    person: { ...p, phone: sensitive ? p.phone : null, guardian_name: sensitive ? p.guardian_name : null },
    studentOf: p.studentOf.map((id) => names.get(id) ?? String(id)),
    staffOf: p.staffOf.map((s) => ({ class_name: names.get(s.classId) ?? String(s.classId), function: s.function })),
    recent: att.slice(0, 12).map((r) => ({ ...r, class_name: names.get(r.class_id) ?? "", asTeacher: r.teacher_id === personId })),
    quarters: [...quarters.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => ({ ...v, pct: Math.round((v.presentes / v.total) * 1000) / 10 })),
    orders,
    birthday,
    canEdit: can(u, "update", personRes("person", p)),
  };
}


// ───────────────────────────── visitantes e oferta na própria tela da chamada
/** Grava visitantes e oferta sem mexer no tema/observações do diário (mesmas regras do diário). */
export function saveCounts(u: Subject, lessonId: Id, visitors: number, offeringCents: number): void {
  const l = getLesson(lessonId);
  saveDiary(u, lessonId, { topic: l.topic ?? "", notes: l.notes ?? "", visitors, offering_cents: offeringCents });
}

/** Chamada + visitantes/oferta numa só gravação (tudo ou nada). */
export function saveAttendanceWithCounts(
  u: Subject, lessonId: Id, presentIds: Id[], counts: { visitors: number; offering_cents: number } | null,
): void {
  db().transaction(() => {
    saveAttendance(u, lessonId, presentIds);
    if (counts) saveCounts(u, lessonId, counts.visitors, counts.offering_cents);
  })();
}

// ───────────────────────────── visão do domingo (estilo aplicativo)
export interface DayCard extends Lesson {
  presentes: number;
  matriculados: number;
  recorded: boolean;
  canFill: boolean;
}

/** Domingos com aula visíveis ao usuário (mais recentes primeiro), para os atalhos de data. */
export function attendanceDates(u: Subject, today = todayISO(), limit = 8): string[] {
  const dates = new Set<string>();
  for (const l of listAttendanceLessons(u, today)) {
    dates.add(l.date);
    if (dates.size >= limit) break;
  }
  return [...dates];
}

/** Todas as classes de um domingo, com presentes/matriculados e situação, mais os totais do dia. */
export function attendanceDay(u: Subject, date: string) {
  const inView = viewFilter(u);
  const lessons = queryLessons(`WHERE l.date = ? AND l.kind='aula' AND l.status <> 'cancelada' ORDER BY c.name`, date)
    .filter((l) => inView(l.class_id))
    .filter((l) => can(u, "read", res("attendance", l)));
  const cards: DayCard[] = lessons.map((l) => {
    const c = db()
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(a.present),0) AS p FROM attendance a
                  JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=? WHERE a.lesson_id=?`)
      .get(l.class_id, l.id) as { n: number; p: number };
    const matriculados = (db().prepare(`SELECT COUNT(*) n FROM enrollments e JOIN people p ON p.id=e.person_id AND p.active=1 WHERE e.class_id=?`).get(l.class_id) as { n: number }).n;
    return { ...l, presentes: c.p, matriculados, recorded: c.n > 0, canFill: can(u, "update", res("attendance", l)) };
  });
  const presentes = cards.reduce((n, c) => n + c.presentes, 0);
  const matriculados = cards.reduce((n, c) => n + c.matriculados, 0);
  return {
    date,
    cards,
    presentes,
    matriculados,
    pct: matriculados ? Math.round((presentes / matriculados) * 100) : null,
    visitantes: cards.reduce((n, c) => n + c.visitors, 0),
    ofertaCents: cards.reduce((n, c) => n + c.offering_cents, 0),
    lancadas: cards.filter((c) => c.recorded).length,
  };
}

// ───────────────────────────── painel da classe
export function getClassInsights(u: Subject, classId: Id, quarter: Quarter, today = todayISO()) {
  authorize(u, "read", { type: "attendance", classIds: [classId] });
  const lessons = (db()
    .prepare(`SELECT l.id, l.date, l.report_status, l.visitors, l.offering_cents,
                     (SELECT COUNT(*) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id) AS total,
                     (SELECT COALESCE(SUM(a.present),0) FROM attendance a JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id WHERE a.lesson_id=l.id) AS presentes
                FROM lessons l WHERE l.class_id=? AND l.kind='aula' AND l.status<>'cancelada' AND l.date<=?
               ORDER BY l.date DESC LIMIT 13`)
    .all(classId, today) as { id: Id; date: string; report_status: ReportStatus; visitors: number; offering_cents: number; total: number; presentes: number }[]);
  const rate = (q: Quarter) => {
    const { from, to } = quarterRange(q);
    const r = db()
      .prepare(`SELECT COUNT(*) n, COALESCE(SUM(a.present),0) p, COUNT(DISTINCT l.id) aulas FROM attendance a
                  JOIN lessons l ON l.id=a.lesson_id JOIN enrollments e ON e.person_id=a.person_id AND e.class_id=l.class_id
                 WHERE l.class_id=? AND l.report_status='validada' AND l.date BETWEEN ? AND ?`)
      .get(classId, from, to) as { n: number; p: number; aulas: number };
    return { pct: r.n ? Math.round((r.p / r.n) * 100) : null, aulas: r.aulas };
  };
  const cur = rate(quarter);
  const prev = rate(shiftQuarter(quarter, -1));
  const { from, to } = quarterRange(quarter);
  const oferta = (db()
    .prepare(`SELECT COALESCE(SUM(offering_cents),0) s FROM lessons WHERE class_id=? AND report_status='validada' AND date BETWEEN ? AND ?`)
    .get(classId, from, to) as { s: number }).s;
  const month = Number(today.slice(5, 7));
  const birthdays = listBirthdays(u, today).filter((b) => b.month === month && b.classes.length > 0);
  const className = (db().prepare(`SELECT name FROM classes WHERE id=?`).get(classId) as { name: string } | undefined)?.name;
  const ranking = can(u, "read", { type: "consolidated", classIds: [classId] })
    ? getPersonFrequency(u, classId, quarter).alunos.filter((a) => a.total > 0)
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.presentes - a.presentes || a.name.localeCompare(b.name))
    : null;
  return {
    series: [...lessons].reverse(),
    aproveitamento: cur.pct,
    delta: cur.pct !== null && prev.pct !== null ? cur.pct - prev.pct : null,
    aulasValidadas: cur.aulas,
    ofertaCents: oferta,
    birthdays: birthdays.filter((b) => className && b.classes.includes(className)),
    ranking,
  };
}
