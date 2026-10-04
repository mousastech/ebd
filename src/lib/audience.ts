/**
 * Público-alvo de comunicados e eventos: todos, um grupo (equipe, professores, alunos, liderança),
 * uma Escala ou uma classe — sempre dentro de uma congregação (ou de todas, quando publicado pelo Pastor).
 */
import type { Resource, ResourceType, Role, Subject } from "./abac";
import { db } from "./db";

type Id = number;
export type AudienceKind = "todos" | "grupo" | "escala" | "classe";
export interface Audience {
  congregation_id: Id | null;
  audience_kind: AudienceKind;
  audience_value: string | null;
}

export const GROUPS: Record<string, string> = {
  equipe: "Equipe (professores, secretários, colaboradores e liderança)",
  professores: "Professores",
  alunos: "Alunos",
  lideranca: "Liderança (superintendência, secretaria e coordenadores)",
};

const LEADERS: Role[] = ["pastor", "supervisor", "superintendente", "secretaria"];

export function audienceClassIds(a: Pick<Audience, "audience_kind" | "audience_value">): Id[] | null {
  if (a.audience_kind === "classe") return [Number(a.audience_value)];
  if (a.audience_kind === "escala")
    return (db().prepare(`SELECT id FROM classes WHERE group_id=? AND active=1`).all(Number(a.audience_value)) as { id: Id }[]).map((r) => r.id);
  return null;
}

export const userClassIds = (s: Subject): Id[] => [...new Set([...s.enrolled, ...s.teaches, ...s.assists, ...s.secretaryOf, ...s.coordinates])];

const reaches = (s: Subject, cong: Id | null) =>
  cong === null || s.congregations == null || s.congregations.includes(cong);

/** A pessoa faz parte do público deste comunicado/evento? */
export function matchesAudience(s: Subject, a: Audience): boolean {
  if (!reaches(s, a.congregation_id)) return false;
  if (LEADERS.includes(s.role)) return true; // a liderança enxerga tudo da sua congregação
  switch (a.audience_kind) {
    case "todos":
      return true;
    case "grupo": {
      const staff = s.teaches.length + s.assists.length + s.secretaryOf.length + s.coordinates.length > 0;
      if (a.audience_value === "equipe") return staff || s.role !== "aluno";
      if (a.audience_value === "professores") return s.teaches.length > 0 || s.role === "professor";
      if (a.audience_value === "alunos") return s.enrolled.length > 0 || s.role === "aluno";
      if (a.audience_value === "lideranca") return s.coordinates.length > 0 || s.role === "coordenador";
      return false;
    }
    default: {
      const target = audienceClassIds(a) ?? [];
      const mine = userClassIds(s);
      return target.some((c) => mine.includes(c));
    }
  }
}

/** Atributos para o ABAC ao publicar/editar: congregação + classes atingidas. */
export function audienceResource(type: ResourceType, a: Audience): Resource {
  return { type, congregationId: a.congregation_id ?? undefined, classIds: audienceClassIds(a) ?? [] };
}

export function describeAudience(a: Audience): string {
  if (a.audience_kind === "todos") return "Todos";
  if (a.audience_kind === "grupo") return GROUPS[a.audience_value ?? ""]?.split(" (")[0] ?? "Grupo";
  if (a.audience_kind === "escala")
    return (db().prepare(`SELECT name FROM class_groups WHERE id=?`).get(Number(a.audience_value)) as { name: string } | undefined)?.name ?? "Escala";
  return `Classe ${(db().prepare(`SELECT name FROM classes WHERE id=?`).get(Number(a.audience_value)) as { name: string } | undefined)?.name ?? ""}`;
}

/** Valida e normaliza o público vindo de um formulário ("todos", "grupo:alunos", "escala:3", "classe:7"). */
export function parseAudience(raw: string, congregationId: Id | null): Audience {
  const [kind, value] = raw.split(":");
  if (kind === "todos" || !kind) return { congregation_id: congregationId, audience_kind: "todos", audience_value: null };
  if (kind === "grupo" && value && GROUPS[value]) return { congregation_id: congregationId, audience_kind: "grupo", audience_value: value };
  if ((kind === "escala" || kind === "classe") && Number.isInteger(Number(value))) {
    const table = kind === "escala" ? "class_groups" : "classes";
    const row = db().prepare(`SELECT congregation_id FROM ${table} WHERE id=?`).get(Number(value)) as { congregation_id: Id } | undefined;
    if (!row) throw new Error("Público inválido.");
    return { congregation_id: row.congregation_id, audience_kind: kind, audience_value: String(Number(value)) };
  }
  throw new Error("Público inválido.");
}
