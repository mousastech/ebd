/**
 * Chamada da equipe (colaboradores): presença de professores, secretários de sala, colaboradores,
 * coordenadores e da equipe geral em cada domingo, por congregação.
 */
import { authorize, can, type Subject } from "./abac";
import { db } from "./db";
import { isISODate } from "./format";
import { UserError } from "./repo";

type Id = number;
export interface StaffMember {
  id: Id;
  name: string;
  photo: string | null;
  roles: string[]; // ex.: ["Professor · Atalaias", "Coordenador · Escala 1"]
  present: boolean | null; // null = aguardando
}

/** Congregação da chamada: a escolhida na tela ou a única que o usuário alcança. */
export function staffCongregation(u: Subject): Id | null {
  if (u.view != null) return u.view;
  if (u.congregations && u.congregations.length === 1) return u.congregations[0];
  return null;
}

export function staffRoster(u: Subject, congregationId: Id, date: string) {
  authorize(u, "read", { type: "staff_attendance", congregationId });
  if (!isISODate(date)) throw new UserError("Data inválida.");
  const fn: Record<string, string> = { professor: "Professor", secretario: "Secretário(a)", colaborador: "Colaborador" };
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, p.photo, s.function AS role, c.name AS place
         FROM class_staff s JOIN classes c ON c.id=s.class_id AND c.active=1 AND c.congregation_id=?
         JOIN people p ON p.id=s.person_id AND p.active=1
       UNION ALL
       SELECT p.id, p.name, p.photo, 'coordenador', g.name FROM class_groups g JOIN people p ON p.id=g.coordinator_id AND p.active=1
        WHERE g.congregation_id=?
       UNION ALL
       SELECT p.id, p.name, p.photo, u.role, '' FROM users u JOIN people p ON p.id=u.person_id AND p.active=1
        WHERE p.congregation_id=? AND u.role IN ('superintendente','secretaria')`,
    )
    .all(congregationId, congregationId, congregationId) as { id: Id; name: string; photo: string | null; role: string; place: string }[];
  const marks = new Map(
    (db().prepare(`SELECT person_id, present FROM staff_attendance WHERE congregation_id=? AND date=?`).all(congregationId, date) as {
      person_id: Id; present: number;
    }[]).map((m) => [m.person_id, m.present === 1]),
  );
  const label = (r: { role: string; place: string }) =>
    r.role === "coordenador" ? `Coordenador · ${r.place}` : r.role === "superintendente" ? "Superintendente" : r.role === "secretaria" ? "Secretaria geral" : `${fn[r.role] ?? r.role} · ${r.place}`;
  const people = new Map<Id, StaffMember>();
  for (const r of rows) {
    const cur = people.get(r.id) ?? { id: r.id, name: r.name, photo: r.photo, roles: [], present: marks.has(r.id) ? marks.get(r.id)! : null };
    const l = label(r);
    if (!cur.roles.includes(l)) cur.roles.push(l);
    people.set(r.id, cur);
  }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const presentes = list.filter((p) => p.present === true).length;
  return {
    date,
    people: list,
    presentes,
    ausentes: list.filter((p) => p.present === false).length,
    pendentes: list.filter((p) => p.present === null).length,
    canEdit: can(u, "update", { type: "staff_attendance", congregationId }),
  };
}

export function saveStaffAttendance(u: Subject, congregationId: Id, date: string, marks: Record<Id, boolean>): void {
  authorize(u, "update", { type: "staff_attendance", congregationId });
  const roster = new Set(staffRoster(u, congregationId, date).people.map((p) => p.id));
  const up = db().prepare(
    `INSERT INTO staff_attendance (congregation_id, date, person_id, present, recorded_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(congregation_id, date, person_id) DO UPDATE SET present=excluded.present, recorded_by=excluded.recorded_by`,
  );
  db().transaction(() => {
    for (const [id, present] of Object.entries(marks)) {
      if (!roster.has(Number(id))) continue; // só quem é da equipe desta congregação
      up.run(congregationId, date, Number(id), present ? 1 : 0, u.personId);
    }
  })();
}
