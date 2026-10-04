/** Categorias do cadastro. Derivadas das matrículas, da equipe de cada classe e da função do usuário. */
export type Category = "aluno" | "professor" | "coordenador" | "secretario" | "colaborador" | "geral";

export const CATEGORIES: Category[] = ["aluno", "professor", "coordenador", "secretario", "colaborador", "geral"];

export const CATEGORY_LABEL: Record<Category, string> = {
  aluno: "Alunos",
  professor: "Professores",
  coordenador: "Coordenadores",
  secretario: "Secretários de sala",
  colaborador: "Colaboradores",
  geral: "Equipe geral",
};

export const CATEGORY_SINGULAR: Record<Category, string> = {
  aluno: "Aluno",
  professor: "Professor",
  coordenador: "Coordenador",
  secretario: "Secretário de sala",
  colaborador: "Colaborador",
  geral: "Equipe geral",
};

/** Funções de equipe dentro de uma classe (class_staff.function). */
export const STAFF_FUNCTIONS = ["coordenador", "professor", "secretario", "colaborador"] as const;
export type StaffFunction = (typeof STAFF_FUNCTIONS)[number];

export const FN_LABEL: Record<string, string> = {
  coordenador: "Coordenador",
  professor: "Professor",
  secretario: "Secretário(a) da sala",
  colaborador: "Colaborador",
};

/** Domingos sem aula que a EBD costuma registrar na escala. */
export const EVENT_OPTIONS = ["Reunião de Obreiros", "Classe remanejada", "Sem aula"] as const;

/** Como preencher os domingos ao gerar a escala de um trimestre. */
export type ScheduleMode = "vazia" | "rodizio" | "remanejada";
