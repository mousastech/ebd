import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  allowedClassIds,
  authorize,
  can,
  canSeeSomething,
  decide,
  type Role,
  type Subject,
} from "./abac";

const JOVENS = 3;
const ADULTOS = 4;
const ALL = [1, 2, 3, 4];

function subject(role: Role, over: Partial<Subject> = {}): Subject {
  return {
    userId: 1,
    personId: 100,
    role,
    coordinates: [],
    teaches: [],
    assists: [],
    secretaryOf: [],
    enrolled: [],
    ...over,
  };
}

const superint = subject("superintendente");
const secretaria = subject("secretaria", { personId: 101 });
const coordJovens = subject("coordenador", { personId: 102, coordinates: [JOVENS] });
const profJovens = subject("professor", { personId: 103, teaches: [JOVENS] });
const colabJovens = subject("colaborador", { personId: 104, assists: [JOVENS] });
const aluno = subject("aluno", { personId: 105, enrolled: [JOVENS] });

describe("negado por padrão", () => {
  it("nega quando nenhuma regra se aplica", () => {
    const d = decide(aluno, "delete", { type: "class", classIds: [JOVENS] });
    expect(d.allowed).toBe(false);
    expect(d.ruleId).toBeUndefined();
  });

  it("authorize lança ForbiddenError", () => {
    expect(() => authorize(aluno, "create", { type: "payment", personId: 105 })).toThrow(
      ForbiddenError,
    );
  });
});

describe("Superintendente", () => {
  it("acessa tudo, inclusive usuários", () => {
    expect(can(superint, "create", { type: "user" })).toBe(true);
    expect(can(superint, "delete", { type: "class", classIds: [ADULTOS] })).toBe(true);
    expect(can(superint, "create", { type: "payment", classIds: [ADULTOS] })).toBe(true);
  });
});

describe("Secretaria", () => {
  it("cadastra pessoas e vê contatos", () => {
    expect(can(secretaria, "create", { type: "person" })).toBe(true);
    expect(can(secretaria, "read_sensitive", { type: "person", classIds: [ADULTOS] })).toBe(true);
  });

  it("lança pagamentos de qualquer classe e corrige presença só até a validação", () => {
    expect(can(secretaria, "create", { type: "payment", classIds: [JOVENS] })).toBe(true);
    expect(can(secretaria, "update", { type: "attendance", classIds: [ADULTOS], reportStatus: "enviada" })).toBe(true);
    expect(can(secretaria, "update", { type: "attendance", classIds: [ADULTOS], reportStatus: "validada" })).toBe(false);
    expect(can(secretaria, "update", { type: "attendance", classIds: [ADULTOS] })).toBe(false); // falha fechada
  });

  it("não gerencia usuários, classes nem a escala", () => {
    expect(can(secretaria, "create", { type: "user" })).toBe(false);
    expect(can(secretaria, "update", { type: "class", classIds: [JOVENS] })).toBe(false);
    expect(can(secretaria, "create", { type: "schedule", classIds: [JOVENS] })).toBe(false);
    expect(can(secretaria, "delete", { type: "payment", classIds: [JOVENS] })).toBe(false);
  });
});

describe("Coordenador (por classes)", () => {
  it("acompanha presença e diário, mas não preenche", () => {
    const r = { classIds: [JOVENS], reportStatus: "pendente" as const };
    expect(can(coordJovens, "read", { type: "attendance", ...r })).toBe(true);
    expect(can(coordJovens, "read", { type: "diary", ...r })).toBe(true);
    expect(can(coordJovens, "create", { type: "attendance", ...r })).toBe(false);
    expect(can(coordJovens, "update", { type: "diary", ...r })).toBe(false);
    expect(can(coordJovens, "create", { type: "report", ...r })).toBe(false);
    expect(can(coordJovens, "update", { type: "report", ...r })).toBe(false);
  });

  it("gerencia a escala da própria classe", () => {
    expect(can(coordJovens, "create", { type: "schedule", classIds: [JOVENS] })).toBe(true);
    expect(can(coordJovens, "update", { type: "lesson", classIds: [JOVENS] })).toBe(true);
  });

  it("não alcança classes que não coordena", () => {
    expect(can(coordJovens, "read", { type: "class", classIds: [ADULTOS] })).toBe(false);
    expect(can(coordJovens, "create", { type: "schedule", classIds: [ADULTOS] })).toBe(false);
    expect(can(coordJovens, "read", { type: "attendance", classIds: [ADULTOS] })).toBe(false);
  });

  it("pessoa em duas classes é visível se ao menos uma é coordenada", () => {
    expect(can(coordJovens, "read", { type: "person", classIds: [ADULTOS, JOVENS] })).toBe(true);
  });

  it("consulta a situação financeira mas não lança pagamento", () => {
    expect(can(coordJovens, "read", { type: "payment", classIds: [JOVENS] })).toBe(true);
    expect(can(coordJovens, "create", { type: "payment", classIds: [JOVENS] })).toBe(false);
  });

  it("não vê contatos fora da classe", () => {
    expect(can(coordJovens, "read_sensitive", { type: "person", classIds: [JOVENS] })).toBe(true);
    expect(can(coordJovens, "read_sensitive", { type: "person", classIds: [ADULTOS] })).toBe(false);
  });

  it("sem classe coordenada, não enxerga nada", () => {
    const semClasse = subject("coordenador", { personId: 110 });
    expect(can(semClasse, "read", { type: "class", classIds: [JOVENS] })).toBe(false);
  });
});

describe("Professor", () => {
  const base = { classIds: [JOVENS], teacherId: 103, reportStatus: "pendente" as const };

  it("com secretário presente, só consulta (não preenche)", () => {
    const r = { ...base, hasSecretary: true, secretaryAbsent: false };
    expect(can(profJovens, "read", { type: "attendance", ...r })).toBe(true);
    expect(can(profJovens, "create", { type: "attendance", ...r })).toBe(false);
    expect(can(profJovens, "update", { type: "diary", ...r })).toBe(false);
    expect(can(profJovens, "create", { type: "report", ...r })).toBe(false);
  });

  it("assume o preenchimento quando o secretário está ausente", () => {
    const r = { ...base, hasSecretary: true, secretaryAbsent: true };
    expect(can(profJovens, "create", { type: "attendance", ...r })).toBe(true);
    expect(can(profJovens, "update", { type: "diary", ...r })).toBe(true);
    expect(can(profJovens, "create", { type: "report", ...r })).toBe(true);
  });

  it("assume o preenchimento quando a classe não tem secretário", () => {
    expect(can(profJovens, "create", { type: "attendance", ...base, hasSecretary: false })).toBe(true);
  });

  it("só o professor escalado na aula substitui", () => {
    const r = { ...base, hasSecretary: false };
    expect(can(profJovens, "create", { type: "attendance", ...r, teacherId: 999 })).toBe(false);
    expect(can(profJovens, "create", { type: "attendance", ...r, teacherId: null })).toBe(false);
    expect(can(profJovens, "create", { type: "attendance", ...r, classIds: [ADULTOS] })).toBe(false);
  });

  it("não preenche relatório enviado ou validado", () => {
    for (const reportStatus of ["enviada", "validada"] as const) {
      expect(can(profJovens, "create", { type: "attendance", ...base, hasSecretary: false, reportStatus })).toBe(false);
    }
  });

  it("avisa a ausência do secretário só se for o escalado e houver secretário", () => {
    expect(can(profJovens, "update", { type: "substitution", ...base, hasSecretary: true })).toBe(true);
    expect(can(profJovens, "update", { type: "substitution", ...base, hasSecretary: true, teacherId: 999 })).toBe(false);
  });

  it("lê o diário só das aulas em que está escalado", () => {
    expect(can(profJovens, "read", { type: "diary", classIds: [JOVENS], teacherId: 103 })).toBe(true);
    expect(can(profJovens, "read", { type: "diary", classIds: [JOVENS], teacherId: 999 })).toBe(false);
  });

  it("não acessa dados financeiros nem a escala (edição)", () => {
    expect(can(profJovens, "read", { type: "payment", classIds: [JOVENS] })).toBe(false);
    expect(can(profJovens, "read", { type: "material_order", classIds: [JOVENS] })).toBe(false);
    expect(can(profJovens, "update", { type: "schedule", classIds: [JOVENS] })).toBe(false);
  });

  it("não vê contatos dos alunos", () => {
    expect(can(profJovens, "read", { type: "person", classIds: [JOVENS] })).toBe(true);
    expect(can(profJovens, "read_sensitive", { type: "person", classIds: [JOVENS] })).toBe(false);
  });
});

describe("Colaborador", () => {
  it("só consulta a presença da sua classe", () => {
    const r = { reportStatus: "pendente" as const, hasSecretary: false };
    expect(can(colabJovens, "read", { type: "attendance", classIds: [JOVENS], ...r })).toBe(true);
    expect(can(colabJovens, "read", { type: "attendance", classIds: [ADULTOS], ...r })).toBe(false);
    expect(can(colabJovens, "create", { type: "attendance", classIds: [JOVENS], ...r })).toBe(false);
  });

  it("não mexe no diário nem no financeiro", () => {
    expect(can(colabJovens, "read", { type: "diary", classIds: [JOVENS], teacherId: 104 })).toBe(false);
    expect(can(colabJovens, "read", { type: "payment", classIds: [JOVENS] })).toBe(false);
  });
});

describe("Aluno", () => {
  it("vê apenas o próprio cadastro e presença", () => {
    expect(can(aluno, "read", { type: "person", personId: 105, classIds: [JOVENS] })).toBe(true);
    expect(can(aluno, "read", { type: "person", personId: 999, classIds: [JOVENS] })).toBe(false);
    expect(can(aluno, "read", { type: "attendance", personId: 105, classIds: [JOVENS] })).toBe(true);
    expect(can(aluno, "read", { type: "attendance", personId: 999, classIds: [JOVENS] })).toBe(false);
  });

  it("vê só o próprio pagamento", () => {
    expect(can(aluno, "read", { type: "payment", personId: 105 })).toBe(true);
    expect(can(aluno, "read", { type: "payment", personId: 999 })).toBe(false);
  });

  it("nunca altera nada", () => {
    for (const type of ["attendance", "payment", "person", "diary", "schedule"] as const) {
      for (const action of ["create", "update", "delete"] as const) {
        expect(can(aluno, action, { type, personId: 105, classIds: [JOVENS], teacherId: 105 })).toBe(
          false,
        );
      }
    }
  });

  it("vê a escala e os aniversariantes da própria classe apenas", () => {
    expect(can(aluno, "read", { type: "schedule", classIds: [JOVENS] })).toBe(true);
    expect(can(aluno, "read", { type: "schedule", classIds: [ADULTOS] })).toBe(false);
    expect(can(aluno, "read", { type: "birthday", classIds: [ADULTOS] })).toBe(false);
  });
});

describe("Secretário da sala (atributo da classe, vale para qualquer função)", () => {
  const sec = subject("colaborador", { personId: 120, assists: [JOVENS], secretaryOf: [JOVENS] });
  const secAluno = subject("aluno", { personId: 121, enrolled: [JOVENS], secretaryOf: [JOVENS] });
  const r = (reportStatus: "pendente" | "enviada" | "validada" | "devolvida") => ({
    classIds: [JOVENS], reportStatus, hasSecretary: true, secretaryAbsent: false,
  });

  it("preenche e envia enquanto pendente ou devolvido", () => {
    for (const s of [sec, secAluno]) {
      for (const st of ["pendente", "devolvida"] as const) {
        expect(can(s, "create", { type: "attendance", ...r(st) })).toBe(true);
        expect(can(s, "update", { type: "diary", ...r(st) })).toBe(true);
        expect(can(s, "create", { type: "report", ...r(st) })).toBe(true);
      }
    }
  });

  it("não altera depois de enviado ou validado", () => {
    for (const st of ["enviada", "validada"] as const) {
      expect(can(sec, "update", { type: "attendance", ...r(st) })).toBe(false);
      expect(can(sec, "create", { type: "report", ...r(st) })).toBe(false);
    }
  });

  it("não alcança outra sala e não valida", () => {
    expect(can(sec, "create", { type: "attendance", ...r("pendente"), classIds: [ADULTOS] })).toBe(false);
    expect(can(sec, "update", { type: "report", ...r("enviada") })).toBe(false);
    expect(can(sec, "read", { type: "consolidated", classIds: [JOVENS] })).toBe(false);
  });

  it("aluno secretário continua sem acesso ao financeiro dos outros", () => {
    expect(can(secAluno, "read", { type: "payment", personId: 999, classIds: [JOVENS] })).toBe(false);
    expect(can(secAluno, "create", { type: "person" })).toBe(false);
  });
});

describe("Relatório: validação e consolidado", () => {
  const rep = (reportStatus: "pendente" | "enviada" | "validada" | "devolvida") =>
    ({ type: "report" as const, classIds: [JOVENS], reportStatus });

  it("secretaria geral valida e devolve; superintendente reabre; ninguém mais", () => {
    expect(can(secretaria, "update", rep("enviada"))).toBe(true);
    expect(can(secretaria, "delete", rep("validada"))).toBe(false);
    expect(can(superint, "delete", rep("validada"))).toBe(true);
    for (const s of [coordJovens, profJovens, colabJovens, aluno]) {
      expect(can(s, "update", rep("enviada"))).toBe(false);
    }
  });

  it("consolidado: superintendência, secretaria geral e coordenador (nas suas classes)", () => {
    expect(can(secretaria, "read", { type: "consolidated", classIds: [ADULTOS] })).toBe(true);
    expect(can(coordJovens, "read", { type: "consolidated", classIds: [JOVENS] })).toBe(true);
    expect(can(coordJovens, "read", { type: "consolidated", classIds: [ADULTOS] })).toBe(false);
    for (const s of [profJovens, colabJovens, aluno]) {
      expect(can(s, "read", { type: "consolidated", classIds: [JOVENS] })).toBe(false);
    }
  });

  it("só o superintendente designa coordenador (gerencia usuários) e cria classes/escalas", () => {
    for (const s of [secretaria, coordJovens, profJovens, colabJovens, aluno]) {
      expect(can(s, "update", { type: "user" })).toBe(false);
      expect(can(s, "create", { type: "class" })).toBe(false);
    }
    expect(can(superint, "update", { type: "user" })).toBe(true);
  });
});

describe("allowedClassIds (filtro de listas)", () => {
  it("superintendente e secretaria veem todas as classes", () => {
    expect(allowedClassIds(superint, "class", "read", ALL)).toEqual(ALL);
    expect(allowedClassIds(secretaria, "class", "read", ALL)).toEqual(ALL);
  });

  it("secretário de sala enxerga também a sala que secretaria", () => {
    const s = subject("aluno", { enrolled: [1], secretaryOf: [4] });
    expect(allowedClassIds(s, "class", "read", ALL)).toEqual([1, 4]);
  });

  it("coordenador, professor, colaborador e aluno veem só as suas", () => {
    for (const s of [coordJovens, profJovens, colabJovens, aluno]) {
      expect(allowedClassIds(s, "class", "read", ALL)).toEqual([JOVENS]);
    }
  });

  it("coordenador de várias classes enxerga todas as suas", () => {
    const multi = subject("coordenador", { coordinates: [1, 4] });
    expect(allowedClassIds(multi, "schedule", "update", ALL)).toEqual([1, 4]);
  });
});

describe("menu (canSeeSomething)", () => {
  it("professor vê o Diário, colaborador não", () => {
    expect(canSeeSomething(profJovens, "diary")).toBe(true);
    expect(canSeeSomething(colabJovens, "diary")).toBe(false);
  });

  it("Validação só para quem valida; Relatório para quem consolida", () => {
    expect(canSeeSomething(secretaria, "report", "update")).toBe(true);
    expect(canSeeSomething(profJovens, "report", "update")).toBe(false);
    expect(canSeeSomething(coordJovens, "consolidated")).toBe(true);
    expect(canSeeSomething(aluno, "consolidated")).toBe(false);
  });

  it("professor e colaborador não veem Materiais; aluno vê (o dele)", () => {
    expect(canSeeSomething(profJovens, "material_order")).toBe(false);
    expect(canSeeSomething(colabJovens, "material_order")).toBe(false);
    expect(canSeeSomething(aluno, "material_order")).toBe(true);
  });

  it("secretaria e coordenador veem Materiais", () => {
    expect(canSeeSomething(secretaria, "material_order")).toBe(true);
    expect(canSeeSomething(coordJovens, "material_order")).toBe(true);
  });
});

describe("matriz de permissões (painel de acesso)", () => {
  it("é derivada das regras e marca as condicionais", async () => {
    const { permissionMatrix } = await import("./abac");
    const m = permissionMatrix();
    expect(m.superintendente.user.map((c) => c.action)).toContain("update");
    expect(m.secretaria.user).toEqual([]);
    // coordenador só preenche se for, ele mesmo, o secretário da sala: tudo condicional
    expect(m.coordenador.attendance.every((c) => c.conditional)).toBe(true);
    expect(m.coordenador.attendance.find((c) => c.action === "create")?.rules).toEqual([
      expect.stringContaining("secretário da sala"),
    ]);
    expect(m.secretaria.report.find((c) => c.action === "update")?.conditional).toBe(false);
    // o papel de secretário da sala aparece (condicional) até para o aluno
    expect(m.aluno.report.map((c) => c.action)).toEqual(["read", "create"]);
  });
});
