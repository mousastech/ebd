import { db } from "./db";
import type { Role, Subject } from "./abac";

export interface SessionUser extends Subject {
  name: string;
  email: string;
  photo: string | null;
}

/**
 * Monta o SUJEITO do ABAC a partir do banco: função, classes em que atua e congregações que alcança.
 * `view` é a congregação escolhida na tela (filtro de visualização); só vale se estiver entre as permitidas.
 */
export function loadSubject(userId: number, view?: number | null): SessionUser | null {
  const u = db()
    .prepare(
      `SELECT u.id, u.person_id, u.email, u.role, p.name, p.photo, p.congregation_id
         FROM users u JOIN people p ON p.id = u.person_id
        WHERE u.id = ? AND p.active = 1`,
    )
    .get(userId) as
    | { id: number; person_id: number; email: string; role: Role; name: string; photo: string | null; congregation_id: number }
    | undefined;
  if (!u) return null;

  const staff = db()
    .prepare(`SELECT class_id, function FROM class_staff WHERE person_id = ?`)
    .all(u.person_id) as { class_id: number; function: string }[];
  const enrolled = db()
    .prepare(`SELECT class_id FROM enrollments WHERE person_id = ?`)
    .all(u.person_id) as { class_id: number }[];

  const pick = (fn: string) => staff.filter((x) => x.function === fn).map((x) => x.class_id);
  // O coordenador coordena todas as classes da(s) Escala(s) em que foi designado.
  const coordinates = (
    db()
      .prepare(`SELECT c.id FROM classes c JOIN class_groups g ON g.id = c.group_id
                WHERE g.coordinator_id = ? AND c.active = 1`)
      .all(u.person_id) as { id: number }[]
  ).map((r) => r.id);

  // Congregações alcançadas: Pastor/Presidente = todas; Supervisor = as da sua região; demais = a de casa.
  let congregations: number[] | null;
  if (u.role === "pastor") congregations = null;
  else if (u.role === "supervisor") {
    congregations = (db().prepare(`SELECT congregation_id FROM user_congregations WHERE user_id=?`).all(u.id) as {
      congregation_id: number;
    }[]).map((r) => r.congregation_id);
  } else congregations = [u.congregation_id];
  const allowedClasses =
    congregations === null
      ? null
      : (db()
          .prepare(`SELECT id FROM classes WHERE congregation_id IN (${congregations.map(() => "?").join(",") || "NULL"})`)
          .all(...congregations) as { id: number }[]).map((r) => r.id);
  const reach = (id: number) => congregations === null || congregations.includes(id);
  const validView = view !== undefined && view !== null && reach(view) ? view : null;
  // quem só alcança uma congregação sempre a vê; quem alcança várias começa no consolidado
  const effectiveView = congregations !== null && congregations.length === 1 ? congregations[0] : validView;

  return {
    userId: u.id,
    personId: u.person_id,
    role: u.role,
    name: u.name,
    email: u.email,
    photo: u.photo,
    coordinates,
    teaches: pick("professor"),
    assists: pick("colaborador"),
    secretaryOf: pick("secretario"),
    enrolled: enrolled.map((e) => e.class_id),
    congregations,
    allowedClasses,
    home: u.congregation_id,
    view: effectiveView,
  };
}
