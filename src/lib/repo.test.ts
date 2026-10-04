import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "./abac";
import { db, openDb } from "./db";
import { sundaysOfQuarter } from "./format";
import * as repo from "./repo";
import { consolidatedCsv } from "./report-csv";
import { loadSubject } from "./subject";

const PAST = "2020-01-05"; // domingos reais
const FUTURE = "2099-01-04";
const Q1_2020 = { year: 2020, q: 1 } as const;

let ids: Record<string, number>;
let cls: { J: number; A: number };
let grp: { G1: number; G2: number };
let L: Record<string, number>;
let order: Record<string, number>;

const as = (key: string) => loadSubject(ids[`u_${key}`])!;
/** leitura crua da aula, só para conferir o estado nos testes */
const lessonRow = (id: number) =>
  db().prepare(`SELECT * FROM lessons WHERE id=?`).get(id) as {
    report_status: string; secretary_absent: number; validated_by: number | null; return_note: string | null;
  };
const dataOk = { topic: "Tema", notes: "ok", visitors: 2, offering_cents: 1500 };

function seed() {
  globalThis.__ebdDb = openDb(":memory:");
  const d = db();
  const person = (name: string, phone = "(11) 90000-0000") =>
    Number(d.prepare(`INSERT INTO people (name, birth_date, phone) VALUES (?, '2000-06-15', ?)`).run(name, phone).lastInsertRowid);
  const user = (pid: number, email: string, role: string) =>
    Number(d.prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (?, ?, 'x', ?)`).run(pid, email, role).lastInsertRowid);
  const group = (n: string, coord: number | null) =>
    Number(d.prepare(`INSERT INTO class_groups (name, coordinator_id) VALUES (?, ?)`).run(n, coord).lastInsertRowid);
  const klass = (n: string, g: number) => Number(d.prepare(`INSERT INTO classes (name, group_id) VALUES (?, ?)`).run(n, g).lastInsertRowid);
  const staff = (c: number, p: number, f: string) => d.prepare(`INSERT INTO class_staff VALUES (?, ?, ?)`).run(c, p, f);
  const enroll = (c: number, p: number) => d.prepare(`INSERT INTO enrollments VALUES (?, ?)`).run(c, p);

  ids = {};
  for (const [key, role] of [
    ["super", "superintendente"], ["sec", "secretaria"], ["sec2", "secretaria"], ["coordJ", "coordenador"], ["coordA", "coordenador"],
    ["profJ1", "professor"], ["profJ2", "professor"], ["profA", "professor"], ["secJ", "colaborador"],
    ["colabJ", "colaborador"], ["alunoJ1", "aluno"],
  ] as const) {
    ids[key] = person(key);
    ids[`u_${key}`] = user(ids[key], `${key}@t.local`, role);
  }
  ids.alunoJ2 = person("alunoJ2");
  ids.alunoA = person("alunoA");

  grp = { G1: group("Escala 1", ids.coordJ), G2: group("Escala 2", ids.coordA) };
  cls = { J: klass("Jovens", grp.G1), A: klass("Adultos", grp.G2) };
  staff(cls.J, ids.profJ1, "professor");
  staff(cls.J, ids.profJ2, "professor");
  staff(cls.J, ids.secJ, "secretario"); // Jovens tem secretário; Adultos não
  staff(cls.J, ids.colabJ, "colaborador");
  staff(cls.A, ids.profA, "professor");
  enroll(cls.J, ids.alunoJ1);
  enroll(cls.J, ids.alunoJ2);
  enroll(cls.A, ids.alunoA);

  const lesson = (c: number, date: string, t: number | null, status = "escalada") =>
    Number(d.prepare(`INSERT INTO lessons (class_id, date, teacher_id, status) VALUES (?, ?, ?, ?)`).run(c, date, t, status).lastInsertRowid);
  L = {
    jPast1: lesson(cls.J, PAST, ids.profJ1),
    jPast2: lesson(cls.J, "2020-01-12", ids.profJ2),
    jFuture: lesson(cls.J, FUTURE, ids.profJ1),
    aPast: lesson(cls.A, PAST, ids.profA),
    jCancelled: lesson(cls.J, "2020-01-19", ids.profJ1, "cancelada"),
  };

  const mat = Number(d.prepare(`INSERT INTO materials (title, price_cents) VALUES ('Revista', 2000)`).run().lastInsertRowid);
  const ord = (p: number, c: number) =>
    Number(d.prepare(`INSERT INTO material_orders (material_id, person_id, class_id, price_cents) VALUES (?, ?, ?, 2000)`).run(mat, p, c).lastInsertRowid);
  order = { alunoJ1: ord(ids.alunoJ1, cls.J), alunoJ2: ord(ids.alunoJ2, cls.J), alunoA: ord(ids.alunoA, cls.A) };
}

beforeEach(seed);

describe("preenchimento: secretário da sala e professor substituto", () => {
  it("secretário da sala (mesmo sendo colaborador) lança presença e diário e envia", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1, ids.profJ1]);
    repo.saveDiary(as("secJ"), L.jPast1, dataOk);
    repo.submitReport(as("secJ"), L.jPast1);
    expect(lessonRow(L.jPast1).report_status).toBe("enviada");
  });

  it("com secretário presente, o professor escalado NÃO preenche", () => {
    expect(() => repo.saveAttendance(as("profJ1"), L.jPast1, [ids.alunoJ1])).toThrow(ForbiddenError);
    expect(() => repo.saveDiary(as("profJ1"), L.jPast1, dataOk)).toThrow(ForbiddenError);
    expect(() => repo.submitReport(as("profJ1"), L.jPast1)).toThrow(ForbiddenError);
  });

  it("na ausência do secretário, o professor escalado assume (e só ele)", () => {
    repo.setSecretaryAbsent(as("profJ1"), L.jPast1, true);
    expect(() => repo.saveAttendance(as("profJ1"), L.jPast1, [ids.alunoJ1])).not.toThrow();
    expect(() => repo.saveDiary(as("profJ1"), L.jPast1, dataOk)).not.toThrow();
    expect(() => repo.submitReport(as("profJ1"), L.jPast1)).not.toThrow();
    // professor de outra aula da mesma classe não vira substituto
    expect(() => repo.setSecretaryAbsent(as("profJ1"), L.jPast2, true)).toThrow(ForbiddenError);
    expect(() => repo.saveAttendance(as("profJ1"), L.jPast2, [])).toThrow(ForbiddenError);
  });

  it("o secretário também pode avisar que faltará, e desfazer", () => {
    repo.setSecretaryAbsent(as("secJ"), L.jPast1, true);
    expect(lessonRow(L.jPast1).secretary_absent).toBe(1);
    repo.setSecretaryAbsent(as("secJ"), L.jPast1, false);
    expect(lessonRow(L.jPast1).secretary_absent).toBe(0);
  });

  it("classe sem secretário: o professor escalado já pode preencher", () => {
    expect(() => repo.saveAttendance(as("profA"), L.aPast, [ids.alunoA])).not.toThrow();
    expect(() => repo.setSecretaryAbsent(as("sec"), L.aPast, true)).toThrow(/não tem secretário/);
  });

  it("coordenador, colaborador comum e aluno não preenchem", () => {
    for (const k of ["coordJ", "colabJ", "alunoJ1", "coordA"]) {
      expect(() => repo.saveAttendance(as(k), L.jPast1, [])).toThrow(ForbiddenError);
      expect(() => repo.saveDiary(as(k), L.jPast1, dataOk)).toThrow(ForbiddenError);
    }
  });

  it("secretário de uma sala não preenche outra", () => {
    expect(() => repo.saveAttendance(as("secJ"), L.aPast, [])).toThrow(ForbiddenError);
  });

  it("ignora ids de pessoas fora da roster e grava só alunos + professor da aula", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1, ids.alunoA, ids.profJ2]);
    const rows = db().prepare(`SELECT person_id FROM attendance WHERE lesson_id=?`).all(L.jPast1) as { person_id: number }[];
    const got = rows.map((r) => r.person_id).sort();
    expect(got).toEqual([ids.alunoJ1, ids.alunoJ2, ids.profJ1].sort());
  });

  it("recusa aula futura, cancelada e domingo sem aula", () => {
    expect(() => repo.saveAttendance(as("super"), L.jFuture, [])).toThrow(repo.UserError);
    expect(() => repo.saveAttendance(as("super"), L.jCancelled, [])).toThrow(repo.UserError);
    repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jPast2, value: "e:Reunião de Obreiros" }]);
    expect(() => repo.saveAttendance(as("super"), L.jPast2, [])).toThrow(/não tem aula/);
  });

  it("valida os números do diário", () => {
    expect(() => repo.saveDiary(as("secJ"), L.jPast1, { ...dataOk, visitors: -1 })).toThrow(repo.UserError);
    expect(() => repo.saveDiary(as("secJ"), L.jPast1, { ...dataOk, offering_cents: 1.5 })).toThrow(repo.UserError);
  });

  it("aluno só enxerga a própria presença, e só de relatórios validados", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    expect(repo.myAttendance(as("alunoJ1")).total).toBe(0);
    repo.submitReport(as("secJ"), L.jPast1);
    repo.validateReport(as("sec"), L.jPast1);
    const mine = repo.myAttendance(as("alunoJ1"));
    expect([mine.total, mine.presentes]).toEqual([1, 1]);
    expect(() => repo.getAttendanceSheet(as("alunoJ1"), L.jPast1)).toThrow(ForbiddenError);
  });
});

describe("fluxo do relatório: enviar → validar/devolver", () => {
  const fill = () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1, ids.profJ1]);
    repo.saveDiary(as("secJ"), L.jPast1, dataOk);
  };

  it("não envia sem presença lançada", () => {
    expect(() => repo.submitReport(as("secJ"), L.jPast1)).toThrow(/presença/);
  });

  it("enviado fica travado para quem preenche", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    expect(() => repo.saveAttendance(as("secJ"), L.jPast1, [])).toThrow(ForbiddenError);
    expect(() => repo.saveDiary(as("secJ"), L.jPast1, dataOk)).toThrow(ForbiddenError);
    expect(() => repo.submitReport(as("secJ"), L.jPast1)).toThrow(ForbiddenError);
  });

  it("secretaria geral valida; ninguém mais valida", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    for (const k of ["coordJ", "profJ1", "secJ", "colabJ", "alunoJ1"]) {
      expect(() => repo.validateReport(as(k), L.jPast1)).toThrow(ForbiddenError);
    }
    repo.validateReport(as("sec"), L.jPast1);
    const l = lessonRow(L.jPast1);
    expect(l.report_status).toBe("validada");
    expect(l.validated_by).toBe(ids.sec);
  });

  it("só valida o que foi enviado", () => {
    expect(() => repo.validateReport(as("sec"), L.jPast1)).toThrow(/enviado/);
  });

  it("quem enviou não valida o próprio relatório (superintendente é exceção)", () => {
    repo.setSecretaryAbsent(as("secJ"), L.jPast1, true);
    repo.saveAttendance(as("sec"), L.jPast1, [ids.alunoJ1]);
    repo.submitReport(as("profJ1"), L.jPast1);
    db().prepare(`UPDATE lessons SET submitted_by=? WHERE id=?`).run(ids.sec, L.jPast1);
    expect(() => repo.validateReport(as("sec"), L.jPast1)).toThrow(/não pode validá-lo/);
    expect(() => repo.validateReport(as("sec2"), L.jPast1)).not.toThrow();
  });

  it("devolver exige motivo, libera edição e permite reenviar", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    expect(() => repo.returnReport(as("sec"), L.jPast1, " ")).toThrow(repo.UserError);
    repo.returnReport(as("sec"), L.jPast1, "Oferta não confere");
    expect(lessonRow(L.jPast1).report_status).toBe("devolvida");
    expect(lessonRow(L.jPast1).return_note).toBe("Oferta não confere");
    repo.saveDiary(as("secJ"), L.jPast1, { ...dataOk, offering_cents: 2000 });
    repo.submitReport(as("secJ"), L.jPast1);
    expect(lessonRow(L.jPast1).report_status).toBe("enviada");
    expect(lessonRow(L.jPast1).return_note).toBeNull();
  });

  it("validado é imutável: nem secretaria corrige; só o superintendente reabre", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    repo.validateReport(as("sec"), L.jPast1);
    expect(() => repo.saveAttendance(as("sec"), L.jPast1, [])).toThrow(ForbiddenError);
    expect(() => repo.saveDiary(as("sec"), L.jPast1, dataOk)).toThrow(ForbiddenError);
    expect(() => repo.returnReport(as("sec"), L.jPast1, "reabrir")).toThrow(ForbiddenError);
    repo.returnReport(as("super"), L.jPast1, "Erro no valor da oferta");
    expect(lessonRow(L.jPast1).report_status).toBe("devolvida");
    expect(lessonRow(L.jPast1).validated_by).toBeNull();
  });

  it("secretaria geral corrige a presença enquanto aguarda validação", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    expect(() => repo.saveAttendance(as("sec"), L.jPast1, [ids.alunoJ2])).not.toThrow();
  });

  it("fila de validação separa enviados, devolvidos e não enviados", () => {
    fill();
    repo.submitReport(as("secJ"), L.jPast1);
    repo.saveAttendance(as("profA"), L.aPast, [ids.alunoA]);
    repo.submitReport(as("profA"), L.aPast);
    repo.returnReport(as("sec"), L.aPast, "Falta oferta");
    const q = repo.listValidationQueue(as("sec"), "2020-02-01");
    expect(q.awaiting.map((l) => l.id)).toEqual([L.jPast1]);
    expect(q.returned.map((l) => l.id)).toEqual([L.aPast]);
    expect(q.missing.map((l) => l.id)).toEqual([L.jPast2]);
    for (const k of ["coordJ", "profJ1", "secJ", "alunoJ1"]) expect(() => repo.listValidationQueue(as(k))).toThrow(ForbiddenError);
  });
});

describe("relatório consolidado do trimestre", () => {
  function validate(lessonId: number, present: number[], visitors: number, offering: number, via: string, by = "sec") {
    repo.saveAttendance(as(via), lessonId, present);
    repo.saveDiary(as(via), lessonId, { topic: "", notes: "", visitors, offering_cents: offering });
    repo.submitReport(as(via), lessonId);
    repo.validateReport(as(by), lessonId);
  }

  it("soma apenas aulas validadas; o resto vira pendência", () => {
    validate(L.jPast1, [ids.alunoJ1, ids.profJ1], 3, 5000, "secJ");
    // jPast2 fica só enviada (não conta)
    repo.saveAttendance(as("secJ"), L.jPast2, [ids.alunoJ1, ids.alunoJ2, ids.profJ2]);
    repo.saveDiary(as("secJ"), L.jPast2, { topic: "", notes: "", visitors: 9, offering_cents: 99900 });
    repo.submitReport(as("secJ"), L.jPast2);

    const c = repo.getConsolidated(as("sec"), Q1_2020, "2020-04-01");
    const j = c.classes.find((k) => k.cls.id === cls.J)!;
    expect(j.total.aulasValidadas).toBe(1);
    expect(j.total.aulasProgramadas).toBe(2); // cancelada não conta
    expect(j.total.pendencias).toBe(1);
    expect(j.total.visitantes).toBe(3);
    expect(j.total.ofertaCents).toBe(5000);
    expect([j.total.alunosPresentes, j.total.alunosRegistros]).toEqual([1, 2]);
    expect(repo.frequency(j.total)).toBe(50);
    expect([j.total.professoresPresentes, j.total.professoresRegistros]).toEqual([1, 1]);
    expect(c.total.ofertaCents).toBe(5000);
    const jan = c.months.find((m) => m.month === 1)!;
    expect(jan.tally.visitantes).toBe(3);
  });

  it("não conta pendência de aula futura", () => {
    const c = repo.getConsolidated(as("sec"), { year: 2099, q: 1 }, "2020-04-01");
    expect(c.total.pendencias).toBe(0);
  });

  it("escopo: coordenador vê só a sua Escala; professor, colaborador e aluno não acessam", () => {
    expect(repo.getConsolidated(as("coordJ"), Q1_2020).classes.map((k) => k.cls.id)).toEqual([cls.J]);
    expect(repo.getConsolidated(as("super"), Q1_2020).classes).toHaveLength(2);
    for (const k of ["profJ1", "colabJ", "alunoJ1"]) {
      expect(() => repo.getConsolidated(as(k), Q1_2020)).toThrow(ForbiddenError);
    }
  });

  it("frequência individual (só validadas) e CSV com BOM, ';' e vírgula decimal", () => {
    validate(L.jPast1, [ids.alunoJ1, ids.profJ1], 1, 1234, "secJ");
    const f = repo.getPersonFrequency(as("coordJ"), cls.J, Q1_2020);
    expect(f.alunos.find((a) => a.id === ids.alunoJ1)).toMatchObject({ presentes: 1, total: 1, pct: 100 });
    expect(f.alunos.find((a) => a.id === ids.alunoJ2)).toMatchObject({ presentes: 0, total: 1, pct: 0 });
    expect(() => repo.getPersonFrequency(as("coordJ"), cls.A, Q1_2020)).toThrow(ForbiddenError);

    const csv = consolidatedCsv(repo.getConsolidated(as("sec"), Q1_2020), (g) => (g === grp.G1 ? "Escala 1" : "Escala 2"));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Escala 1";"Jovens";"Total 1º trimestre 2020"');
    expect(csv).toContain(";12,34\r\n");
    expect(csv).toContain('"EBD";"Todas as classes"');
  });
});

describe("escala trimestral", () => {
  const Q = { year: 2098, q: 1 } as const;

  it("gera todos os domingos do trimestre e é idempotente", () => {
    const n = repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "rodizio");
    expect(n).toBe(sundaysOfQuarter(Q).length);
    expect(repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "rodizio")).toBe(0);
  });

  it("rodízio alterna os professores da classe em sequência", () => {
    repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "rodizio");
    const t = repo.listSchedule(as("coordJ"), { from: "2098-01-01", to: "2098-03-31" }).map((l) => l.teacher_id);
    expect(t.slice(0, 4)).toEqual([ids.profJ1, ids.profJ2, ids.profJ1, ids.profJ2]);
  });

  it("rodízio continua de onde o trimestre anterior parou", () => {
    db().prepare(`INSERT INTO lessons (class_id, date, teacher_id) VALUES (?, '2097-12-28', ?)`).run(cls.J, ids.profJ1);
    repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "rodizio");
    const first = repo.listSchedule(as("coordJ"), { from: "2098-01-01", to: "2098-03-31" })[0];
    expect(first.teacher_id).toBe(ids.profJ2);
  });

  it("pula professor que já leciona em outra classe no mesmo domingo", () => {
    db().prepare(`INSERT INTO class_staff VALUES (?, ?, 'professor')`).run(cls.A, ids.profJ1);
    repo.generateQuarterSchedule(as("coordA"), cls.A, Q, "rodizio"); // A: profA, profJ1...
    repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "rodizio");
    const rows = repo.listSchedule(as("super"), { from: "2098-01-01", to: "2098-03-31" });
    const key = new Set<string>();
    for (const l of rows.filter((x) => x.teacher_id)) {
      const k = `${l.date}|${l.teacher_id}`;
      expect(key.has(k)).toBe(false);
      key.add(k);
    }
  });

  it("classe remanejada marca todos os domingos como evento", () => {
    repo.generateQuarterSchedule(as("super"), cls.A, Q, "remanejada");
    const rows = repo.listSchedule(as("super"), { from: "2098-01-01", to: "2098-03-31" }).filter((l) => l.class_id === cls.A);
    expect(rows.every((l) => l.kind === "evento" && l.event_label === "Classe remanejada")).toBe(true);
  });

  it("edita a grade: professor, evento (Reunião de Obreiros) e volta a ser aula", () => {
    repo.generateQuarterSchedule(as("coordJ"), cls.J, Q, "vazia");
    const [a, b] = repo.listSchedule(as("coordJ"), { from: "2098-01-01", to: "2098-03-31" });
    expect(repo.saveQuarterSchedule(as("coordJ"), cls.J, [
      { lessonId: a.id, value: `p:${ids.profJ2}` },
      { lessonId: b.id, value: "e:Reunião de Obreiros" },
    ])).toBe(2);
    let rows = repo.listSchedule(as("coordJ"), { from: "2098-01-01", to: "2098-03-31" });
    expect(rows[0].teacher_id).toBe(ids.profJ2);
    expect(rows[1]).toMatchObject({ kind: "evento", event_label: "Reunião de Obreiros", teacher_id: null });
    repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: b.id, value: "" }]);
    rows = repo.listSchedule(as("coordJ"), { from: "2098-01-01", to: "2098-03-31" });
    expect(rows[1].kind).toBe("aula");
  });

  it("recusa professor de fora da classe e conflito no mesmo dia", () => {
    expect(() => repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jFuture, value: `p:${ids.profA}` }])).toThrow(/não leciona/);
    db().prepare(`INSERT INTO class_staff VALUES (?, ?, 'professor')`).run(cls.J, ids.profA);
    db().prepare(`INSERT INTO lessons (class_id, date, teacher_id) VALUES (?, ?, ?)`).run(cls.A, FUTURE, ids.profA);
    expect(() => repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jFuture, value: `p:${ids.profA}` }])).toThrow(/já está escalado/);
  });

  it("não altera aula com relatório enviado nem vira evento com presença lançada", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    expect(() => repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jPast1, value: "e:Sem aula" }])).toThrow(/presença/);
    repo.submitReport(as("secJ"), L.jPast1);
    expect(() => repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jPast1, value: `p:${ids.profJ2}` }])).toThrow(/relatório enviado/);
  });

  it("trocar o professor apaga a presença do anterior", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.profJ1, ids.alunoJ1]);
    repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jPast1, value: `p:${ids.profJ2}` }]);
    const has = db().prepare(`SELECT 1 FROM attendance WHERE lesson_id=? AND person_id=?`).get(L.jPast1, ids.profJ1);
    expect(has).toBeUndefined();
  });

  it("permissões: coordenador só na sua Escala; secretaria, professor e aluno não editam", () => {
    expect(() => repo.generateQuarterSchedule(as("coordJ"), cls.A, Q, "vazia")).toThrow(ForbiddenError);
    for (const k of ["sec", "profJ1", "secJ", "colabJ", "alunoJ1"]) {
      expect(() => repo.generateQuarterSchedule(as(k), cls.J, Q, "vazia")).toThrow(ForbiddenError);
      expect(() => repo.saveQuarterSchedule(as(k), cls.J, [])).toThrow(ForbiddenError);
    }
  });

  it("cada função vê a escala conforme seu escopo", () => {
    const classesOf = (k: string) => [...new Set(repo.listSchedule(as(k)).map((l) => l.class_id))].sort();
    expect(classesOf("super")).toEqual([cls.J, cls.A].sort());
    expect(classesOf("sec")).toEqual([cls.J, cls.A].sort());
    expect(classesOf("profJ1")).toEqual([cls.J]);
    expect(classesOf("secJ")).toEqual([cls.J]);
    expect(classesOf("alunoJ1")).toEqual([cls.J]);
    expect(classesOf("coordA")).toEqual([cls.A]);
  });
});

describe("Escalas, coordenadores e secretários", () => {
  it("o coordenador vem da Escala: enxerga todas as classes dela e só elas", () => {
    expect(as("coordJ").coordinates).toEqual([cls.J]);
    expect(repo.listClasses(as("coordJ")).map((c) => c.id)).toEqual([cls.J]);
  });

  it("só o superintendente designa coordenador, cria Escala/classe e move classe", () => {
    expect(() => repo.setGroupCoordinator(as("super"), grp.G1, ids.coordA)).not.toThrow();
    expect(as("coordA").coordinates.sort()).toEqual([cls.J, cls.A].sort());
    expect(as("coordJ").coordinates).toEqual([]);
    for (const k of ["sec", "coordJ", "profJ1", "secJ", "alunoJ1"]) {
      expect(() => repo.setGroupCoordinator(as(k), grp.G1, ids.profJ1)).toThrow(ForbiddenError);
      expect(() => repo.createGroup(as(k), "Escala X", null)).toThrow(ForbiddenError);
      expect(() => repo.createClass(as(k), "Nova", "", grp.G1)).toThrow(ForbiddenError);
      expect(() => repo.setClassGroup(as(k), cls.J, grp.G2)).toThrow(ForbiddenError);
    }
  });

  it("mover classe de Escala muda quem a coordena", () => {
    repo.setClassGroup(as("super"), cls.J, grp.G2);
    expect(as("coordA").coordinates.sort()).toEqual([cls.J, cls.A].sort());
    expect(as("coordJ").coordinates).toEqual([]);
  });

  it("nome de Escala é único", () => {
    expect(() => repo.createGroup(as("super"), "Escala 1", null)).toThrow(/Já existe/);
  });

  it("cada sala tem um único secretário: designar outro substitui o atual", () => {
    repo.addStaff(as("super"), cls.J, ids.alunoJ1, "secretario");
    const secs = db().prepare(`SELECT person_id FROM class_staff WHERE class_id=? AND function='secretario'`).all(cls.J) as { person_id: number }[];
    expect(secs.map((s) => s.person_id)).toEqual([ids.alunoJ1]);
    expect(as("alunoJ1").secretaryOf).toEqual([cls.J]);
    expect(as("secJ").secretaryOf).toEqual([]);
  });

  it("aluno secretário preenche a sala dele e continua sem acesso ao resto", () => {
    repo.addStaff(as("super"), cls.J, ids.alunoJ1, "secretario");
    expect(() => repo.saveAttendance(as("alunoJ1"), L.jPast1, [ids.alunoJ1])).not.toThrow();
    expect(() => repo.listOrders(as("alunoJ1"))).not.toThrow();
    expect(repo.listOrders(as("alunoJ1")).map((o) => o.person_id)).toEqual([ids.alunoJ1]);
    expect(() => repo.saveAttendance(as("alunoJ1"), L.aPast, [])).toThrow(ForbiddenError);
  });

  it("coordenador gerencia a equipe da sua Escala, não de outra", () => {
    expect(() => repo.addStaff(as("coordJ"), cls.J, ids.profA, "professor")).not.toThrow();
    expect(() => repo.addStaff(as("coordJ"), cls.A, ids.profJ1, "professor")).toThrow(ForbiddenError);
    expect(() => repo.addStaff(as("coordJ"), cls.J, ids.profA, "chefe")).toThrow(repo.UserError);
  });
});

describe("material didático e pagamentos", () => {
  it("secretaria registra pagamento parcial e depois quita", () => {
    repo.registerPayment(as("sec"), order.alunoJ1, 500, "pix", PAST);
    repo.registerPayment(as("sec"), order.alunoJ1, 1500, "dinheiro", PAST);
    const o = repo.listOrders(as("sec")).find((x) => x.id === order.alunoJ1)!;
    expect(o.balance_cents).toBe(0);
    expect(o.payments).toHaveLength(2);
  });

  it("recusa pagamento acima do saldo e valores inválidos", () => {
    expect(() => repo.registerPayment(as("sec"), order.alunoJ1, 2001, "pix", PAST)).toThrow(/ultrapassa/);
    expect(() => repo.registerPayment(as("sec"), order.alunoJ1, 0, "pix", PAST)).toThrow(repo.UserError);
    expect(() => repo.registerPayment(as("sec"), order.alunoJ1, 100, "fiado", PAST)).toThrow(repo.UserError);
  });

  it("coordenador consulta, mas não lança; professor, colaborador e aluno também não", () => {
    for (const k of ["coordJ", "profJ1", "colabJ", "secJ", "alunoJ1"]) {
      expect(() => repo.registerPayment(as(k), order.alunoJ1, 100, "pix", PAST)).toThrow(ForbiddenError);
    }
  });

  it("visibilidade das revistas por função", () => {
    const visible = (k: string) => repo.listOrders(as(k)).map((o) => o.person_id).sort();
    expect(visible("super")).toHaveLength(3);
    expect(visible("sec")).toHaveLength(3);
    expect(visible("coordJ")).toEqual([ids.alunoJ1, ids.alunoJ2].sort());
    expect(visible("alunoJ1")).toEqual([ids.alunoJ1]);
    expect(visible("profJ1")).toEqual([]);
    expect(visible("colabJ")).toEqual([]);
  });

  it("aluno não vê pagamentos de colegas", () => {
    repo.registerPayment(as("sec"), order.alunoJ2, 1000, "pix", PAST);
    const mine = repo.listOrders(as("alunoJ1"));
    expect(mine).toHaveLength(1);
    expect(mine[0].payments).toHaveLength(0);
  });

  it("nova revista gera um pedido por aluno da classe; só secretaria/superintendente", () => {
    expect(repo.createMaterial(as("sec"), { title: "Nova", period: "", priceCents: 1000, classId: cls.J })).toBe(2);
    expect(() => repo.createMaterial(as("coordJ"), { title: "X", period: "", priceCents: 1000, classId: cls.J })).toThrow(ForbiddenError);
  });
});

describe("pessoas e contatos", () => {
  it("professor vê os alunos sem telefone; secretaria vê o telefone", () => {
    const viaProf = repo.listPeople(as("profJ1")).find((p) => p.id === ids.alunoJ1)!;
    expect(viaProf.phone).toBeNull();
    const viaSec = repo.listPeople(as("sec")).find((p) => p.id === ids.alunoJ1)!;
    expect(viaSec.phone).toBe("(11) 90000-0000");
  });

  it("coordenador vê contatos só das suas classes", () => {
    const people = repo.listPeople(as("coordJ"));
    expect(people.find((p) => p.id === ids.alunoJ1)?.phone).not.toBeNull();
    expect(people.find((p) => p.id === ids.alunoA)).toBeUndefined();
  });

  it("aluno vê somente o próprio cadastro", () => {
    expect(repo.listPeople(as("alunoJ1")).map((p) => p.id)).toEqual([ids.alunoJ1]);
  });

  it("aniversariantes: aluno vê os da própria classe, sem outras", () => {
    const names = repo.listBirthdays(as("alunoJ1")).map((b) => b.id);
    expect(names).toContain(ids.alunoJ2);
    expect(names).not.toContain(ids.alunoA);
  });

  it("só secretaria/superintendente cadastram pessoas", () => {
    const form = { name: "Novo", birth_date: "2010-01-01", phone: "", guardian_name: "" };
    expect(() => repo.createPerson(as("sec"), form)).not.toThrow();
    expect(() => repo.createPerson(as("coordJ"), form)).toThrow(ForbiddenError);
    expect(() => repo.createPerson(as("profJ1"), form)).toThrow(ForbiddenError);
  });
});

describe("equipe, matrículas e usuários", () => {
  it("coordenador não altera a equipe de outra classe", () => {
    expect(() => repo.addStaff(as("coordJ"), cls.A, ids.profJ1, "professor")).toThrow(ForbiddenError);
  });

  it("matrícula: secretaria e coordenador da classe; professor não", () => {
    expect(() => repo.enrollStudent(as("sec"), cls.A, ids.alunoJ1)).not.toThrow();
    expect(() => repo.enrollStudent(as("coordJ"), cls.J, ids.alunoA)).not.toThrow();
    expect(() => repo.enrollStudent(as("coordJ"), cls.A, ids.alunoJ1)).toThrow(ForbiddenError);
    expect(() => repo.enrollStudent(as("profJ1"), cls.J, ids.alunoA)).toThrow(ForbiddenError);
  });

  it("apenas superintendente gerencia usuários", () => {
    expect(repo.listUsers(as("super")).length).toBeGreaterThan(0);
    for (const k of ["sec", "coordJ", "profJ1", "colabJ", "secJ", "alunoJ1"]) {
      expect(() => repo.listUsers(as(k))).toThrow(ForbiddenError);
      expect(() => repo.changeUserRole(as(k), ids.u_alunoJ1, "superintendente")).toThrow(ForbiddenError);
    }
  });

  it("não rebaixa o único superintendente", () => {
    expect(() => repo.changeUserRole(as("super"), ids.u_super, "professor")).toThrow(/único superintendente/);
  });

  it("valida e-mail e senha ao criar usuário", () => {
    const base = { personId: ids.alunoJ2, email: "novo@t.local", password: "senha-forte-1", role: "aluno" as const };
    expect(() => repo.createUser(as("super"), { ...base, password: "curta" })).toThrow(repo.UserError);
    expect(() => repo.createUser(as("super"), { ...base, email: "invalido" })).toThrow(repo.UserError);
    expect(() => repo.createUser(as("super"), base)).not.toThrow();
    expect(() => repo.createUser(as("super"), base)).toThrow(/Já existe/);
  });
});

describe("painel administrativo (BI)", () => {
  function validate(lessonId: number, present: number[], offering: number, via: string) {
    repo.saveAttendance(as(via), lessonId, present);
    repo.saveDiary(as(via), lessonId, { topic: "", notes: "", visitors: 1, offering_cents: offering });
    repo.submitReport(as(via), lessonId);
    repo.validateReport(as("sec"), lessonId);
  }

  it("agrega por Escala, situação dos relatórios e alunos com baixa frequência", () => {
    validate(L.jPast1, [ids.alunoJ1, ids.profJ1], 1000, "secJ");
    validate(L.jPast2, [ids.alunoJ1], 500, "secJ");
    validate(L.aPast, [ids.alunoA, ids.profA], 300, "profA");
    const bi = repo.getBI(as("super"), Q1_2020, "2020-04-01");
    expect(bi.groups.map((g) => [g.name, g.coordinator, g.total.ofertaCents])).toEqual([
      ["Escala 1", "coordJ", 1500], ["Escala 2", "coordA", 300],
    ]);
    expect(bi.reports).toEqual({ pendente: 0, enviada: 0, devolvida: 0, validada: 3 });
    expect(bi.low.map((a) => a.id)).toEqual([ids.alunoJ2]); // 0 de 2
    expect(bi.trend).toHaveLength(4);
    expect(bi.trend[3].ofertaCents).toBe(1800);
    expect(bi.mediaPorAula).toBe(1);
    expect(bi.finance?.pedidos).toBe(3);
    const t = bi.teachers.find((x) => x.id === ids.profJ2)!;
    expect([t.escalado, t.presente, t.registrado]).toEqual([1, 0, 1]);
  });

  it("coordenador vê só a sua Escala; quem não lê o consolidado não acessa", () => {
    const bi = repo.getBI(as("coordA"), Q1_2020, "2020-04-01");
    expect(bi.groups.map((g) => g.name)).toEqual(["Escala 2"]);
    expect(bi.current.classes.map((c) => c.cls.id)).toEqual([cls.A]);
    for (const k of ["profJ1", "secJ", "colabJ", "alunoJ1"]) {
      expect(() => repo.getBI(as(k), Q1_2020)).toThrow(ForbiddenError);
    }
  });

  it("usuários por função: só a superintendência", () => {
    expect(repo.usersByRole(as("super")).secretaria).toBe(2);
    expect(() => repo.usersByRole(as("sec"))).toThrow(ForbiddenError);
  });
});

describe("recursos extras: senha, ausentes, chamada em branco, ficha", () => {
  it("só o superintendente redefine senha; exige 8 caracteres", async () => {
    const { verifyPassword } = await import("./password");
    expect(() => repo.resetUserPassword(as("super"), ids.u_profJ1, "curta")).toThrow(repo.UserError);
    repo.resetUserPassword(as("super"), ids.u_profJ1, "nova-senha-123");
    const h = (db().prepare(`SELECT password_hash h FROM users WHERE id=?`).get(ids.u_profJ1) as { h: string }).h;
    expect(verifyPassword("nova-senha-123", h)).toBe(true);
    for (const k of ["sec", "coordJ", "profJ1"]) {
      expect(() => repo.resetUserPassword(as(k), ids.u_alunoJ1, "outra-senha-123")).toThrow(ForbiddenError);
    }
  });

  it("ausentes: quem faltou às N últimas aulas com chamada; contato só com permissão", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    repo.saveAttendance(as("secJ"), L.jPast2, [ids.alunoJ1]);
    const viaSec = repo.listAbsentees(as("sec"), 2);
    expect(viaSec.map((a) => a.id)).toEqual([ids.alunoJ2]);
    expect(viaSec[0].phone).toBe("(11) 90000-0000");
    expect(repo.listAbsentees(as("sec"), 3)).toEqual([]); // só 2 aulas com chamada
    const viaProf = repo.listAbsentees(as("profJ1"), 2);
    expect(viaProf.map((a) => a.id)).toEqual([ids.alunoJ2]);
    expect(viaProf[0].phone).toBeNull();
    expect(repo.listAbsentees(as("coordA"), 2)).toEqual([]);
    expect(repo.listAbsentees(as("alunoJ1"), 2)).toEqual([]);
  });

  it("lista de chamada em branco: todos os domingos, alunos da classe, escopo por função", () => {
    const sheets = repo.getBlankRoster(as("coordJ"), Q1_2020);
    expect(sheets.map((s) => s.cls.id)).toEqual([cls.J]);
    expect(sheets[0].dates).toHaveLength(sundaysOfQuarter(Q1_2020).length);
    expect(sheets[0].students.map((s) => s.id).sort()).toEqual([ids.alunoJ1, ids.alunoJ2].sort());
    expect(repo.getBlankRoster(as("alunoJ1"), Q1_2020)).toEqual([]);
  });

  it("ficha: aluno vê a própria; não vê a de colega; professor vê sem contato", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    repo.submitReport(as("secJ"), L.jPast1);
    repo.validateReport(as("sec"), L.jPast1);
    const own = repo.getPersonFile(as("alunoJ1"), ids.alunoJ1, "2020-04-01")!;
    expect(own.quarters).toEqual([{ label: "1º trimestre 2020", presentes: 1, total: 1, pct: 100 }]);
    expect(own.orders).toHaveLength(1);
    expect(() => repo.getPersonFile(as("alunoJ1"), ids.alunoJ2)).toThrow(ForbiddenError);
    const viaProf = repo.getPersonFile(as("profJ1"), ids.alunoJ2, "2020-04-01")!;
    expect(viaProf.person.phone).toBeNull();
    expect(viaProf.recent).toHaveLength(1);
    expect(viaProf.orders).toEqual([]);
    expect(() => repo.getPersonFile(as("coordA"), ids.alunoJ1)).toThrow(ForbiddenError);
  });
});

describe("chamada estilo app: presença + visitantes/oferta e visão do domingo", () => {
  it("grava presença, visitantes e oferta juntos; tudo ou nada", () => {
    repo.saveAttendanceWithCounts(as("secJ"), L.jPast1, [ids.alunoJ1], { visitors: 2, offering_cents: 4730 });
    expect(db().prepare(`SELECT visitors, offering_cents FROM lessons WHERE id=?`).get(L.jPast1)).toEqual({ visitors: 2, offering_cents: 4730 });
    // visitantes inválido: nada é gravado (nem a presença nova)
    expect(() => repo.saveAttendanceWithCounts(as("secJ"), L.jPast1, [ids.alunoJ2], { visitors: -1, offering_cents: 0 })).toThrow(repo.UserError);
    const p = db().prepare(`SELECT present FROM attendance WHERE lesson_id=? AND person_id=?`).get(L.jPast1, ids.alunoJ2) as { present: number };
    expect(p.present).toBe(0);
  });

  it("professor com secretário presente não grava oferta pela chamada", () => {
    expect(() => repo.saveAttendanceWithCounts(as("profJ1"), L.jPast1, [], { visitors: 0, offering_cents: 100 })).toThrow(ForbiddenError);
  });

  it("visão do domingo: cartões por turma e totais, no escopo da função", () => {
    repo.saveAttendanceWithCounts(as("secJ"), L.jPast1, [ids.alunoJ1], { visitors: 1, offering_cents: 1000 });
    const day = repo.attendanceDay(as("sec"), PAST);
    expect(day.cards.map((c) => c.class_id).sort()).toEqual([cls.J, cls.A].sort());
    expect([day.presentes, day.matriculados, day.visitantes, day.ofertaCents, day.lancadas]).toEqual([1, 3, 1, 1000, 1]);
    expect(repo.attendanceDay(as("coordA"), PAST).cards.map((c) => c.class_id)).toEqual([cls.A]);
    expect(repo.attendanceDates(as("sec"), "2020-02-01")).toEqual(["2020-01-12", PAST]);
  });

  it("painel da classe: série, aproveitamento e ranking só para quem lê o consolidado", () => {
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    repo.submitReport(as("secJ"), L.jPast1);
    repo.validateReport(as("sec"), L.jPast1);
    const viaCoord = repo.getClassInsights(as("coordJ"), cls.J, Q1_2020, "2020-04-01");
    expect(viaCoord.aproveitamento).toBe(50);
    expect(viaCoord.series.map((s) => s.presentes)).toEqual([1, 0]);
    expect(viaCoord.ranking?.[0].id).toBe(ids.alunoJ1);
    expect(repo.getClassInsights(as("profJ1"), cls.J, Q1_2020, "2020-04-01").ranking).toBeNull();
    expect(() => repo.getClassInsights(as("coordA"), cls.J, Q1_2020)).toThrow(ForbiddenError);
  });
});

describe("várias congregações (sede e filiais)", () => {
  let F: number; // filial
  let clsF: number;
  let lessonF: number;
  function setupFilial() {
    const d = db();
    F = Number(d.prepare(`INSERT INTO congregations (name, kind) VALUES ('Filial', 'filial')`).run().lastInsertRowid);
    const person = (name: string, cong = F) =>
      Number(d.prepare(`INSERT INTO people (name, congregation_id, phone) VALUES (?, ?, '(11) 1')`).run(name, cong).lastInsertRowid);
    const user = (pid: number, email: string, role: string) =>
      Number(d.prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (?, ?, 'x', ?)`).run(pid, email, role).lastInsertRowid);
    const g = Number(d.prepare(`INSERT INTO class_groups (name, congregation_id) VALUES ('Escala 1', ?)`).run(F).lastInsertRowid);
    clsF = Number(d.prepare(`INSERT INTO classes (name, group_id, congregation_id) VALUES ('Adultos F', ?, ?)`).run(g, F).lastInsertRowid);
    ids.alunoF = person("alunoF");
    d.prepare(`INSERT INTO enrollments VALUES (?, ?)`).run(clsF, ids.alunoF);
    lessonF = Number(d.prepare(`INSERT INTO lessons (class_id, date) VALUES (?, ?)`).run(clsF, PAST).lastInsertRowid);
    ids.superF = person("superF");
    ids.u_superF = user(ids.superF, "superf@t", "superintendente");
    ids.pastor = person("pastor", 1);
    ids.u_pastor = user(ids.pastor, "pastor@t", "pastor");
    ids.sup = person("sup", 1);
    ids.u_sup = user(ids.sup, "sup@t", "supervisor");
    d.prepare(`INSERT INTO user_congregations VALUES (?, ?)`).run(ids.u_sup, F);
  }
  beforeEach(setupFilial);

  it("superintendente da sede não vê nem altera a filial (e vice-versa)", () => {
    expect(repo.listClasses(as("super")).map((c) => c.id)).not.toContain(clsF);
    expect(repo.listClasses(as("superF")).map((c) => c.id)).toEqual([clsF]);
    expect(() => repo.saveAttendance(as("super"), lessonF, [])).toThrow(ForbiddenError);
    expect(() => repo.getAttendanceSheet(as("superF"), L.jPast1)).toThrow(ForbiddenError);
    expect(repo.listPeople(as("super")).map((p) => p.id)).not.toContain(ids.alunoF);
    expect(repo.listPeople(as("superF")).map((p) => p.id)).toContain(ids.superF);
    expect(() => repo.enrollStudent(as("superF"), clsF, ids.alunoJ1)).toThrow(/outra congregação/);
  });

  it("secretaria geral da sede valida só relatórios da sede", () => {
    db().prepare(`INSERT INTO attendance VALUES (?, ?, 1)`).run(lessonF, ids.alunoF);
    db().prepare(`UPDATE lessons SET report_status='enviada', submitted_by=? WHERE id=?`).run(ids.superF, lessonF);
    expect(() => repo.validateReport(as("sec"), lessonF)).toThrow(ForbiddenError);
    expect(repo.listValidationQueue(as("sec"), "2020-02-01").awaiting.map((l) => l.id)).not.toContain(lessonF);
  });

  it("Pastor/Presidente alcança todas; a visão escolhida filtra as listas", () => {
    const all = repo.listClasses(as("pastor")).map((c) => c.id);
    expect(all).toEqual(expect.arrayContaining([cls.J, cls.A, clsF]));
    const pastorF = loadSubject(ids.u_pastor, F)!;
    expect(repo.listClasses(pastorF).map((c) => c.id)).toEqual([clsF]);
    expect(repo.getConsolidated(pastorF, Q1_2020).classes.map((c) => c.cls.id)).toEqual([clsF]);
    // visão inválida (fora do alcance) é ignorada
    expect(loadSubject(ids.u_superF, 1)!.view).toBe(F);
  });

  it("supervisor regional só lê as congregações da região", () => {
    const sup = as("sup");
    expect(repo.listClasses(sup).map((c) => c.id)).toEqual([clsF]);
    expect(() => repo.getAttendanceSheet(sup, lessonF)).not.toThrow();
    expect(() => repo.saveAttendance(sup, lessonF, [])).toThrow(ForbiddenError);
    expect(() => repo.getConsolidated(sup, Q1_2020)).not.toThrow();
    expect(() => repo.listUsers(sup)).toThrow(ForbiddenError);
  });

  it("criações caem na congregação certa", () => {
    const id = repo.createClass(as("superF"), "Nova F", "", null);
    expect((db().prepare(`SELECT congregation_id c FROM classes WHERE id=?`).get(id) as { c: number }).c).toBe(F);
    const pid = repo.createPerson(as("superF"), { name: "x", birth_date: "", phone: "", guardian_name: "" });
    expect((db().prepare(`SELECT congregation_id c FROM people WHERE id=?`).get(pid) as { c: number }).c).toBe(F);
    expect(() => repo.setClassGroup(as("super"), cls.J, (db().prepare(`SELECT id FROM class_groups WHERE congregation_id=?`).get(F) as { id: number }).id)).toThrow(/outra congregação/);
  });

  it("só o Pastor concede Pastor/Supervisor; superintendente não mexe em usuários de outra congregação", () => {
    expect(() => repo.changeUserRole(as("super"), ids.u_profJ1, "supervisor")).toThrow(/Pastor/);
    expect(() => repo.createUser(as("super"), { personId: ids.alunoJ2, email: "x@t.l", password: "12345678", role: "pastor" })).toThrow(/Pastor/);
    expect(() => repo.changeUserRole(as("super"), ids.u_superF, "professor")).toThrow(ForbiddenError);
    expect(() => repo.resetUserPassword(as("super"), ids.u_pastor, "12345678")).toThrow(ForbiddenError);
    expect(() => repo.changeUserRole(as("pastor"), ids.u_profJ1, "supervisor")).not.toThrow();
    expect(repo.listUsers(as("superF")).map((x) => x.id)).toEqual([ids.u_superF]);
  });
});

describe("gestão: visitantes, caixa, chamada da equipe, termômetro e pedido de revistas", () => {
  const validate = (lessonId: number, present: number[], offering: number) => {
    repo.saveAttendanceWithCounts(as("secJ"), lessonId, present, { visitors: 0, offering_cents: offering });
    repo.submitReport(as("secJ"), lessonId);
    repo.validateReport(as("sec"), lessonId);
  };

  it("visitante: secretário da sala registra; retorno e matrícula viram aluno", async () => {
    const v = await import("./visitors");
    const id = v.createVisitor(as("secJ"), { name: "Fulano", phone: "11999990000", classId: cls.J, date: PAST, howFound: "Convite de membro", invitedBy: "alunoJ1", notes: "" });
    expect(() => v.createVisitor(as("secJ"), { name: "X", phone: "", classId: cls.A, date: PAST, howFound: "", invitedBy: "", notes: "" })).toThrow(ForbiddenError);
    expect(() => v.createVisitor(as("alunoJ1"), { name: "X", phone: "", classId: cls.J, date: PAST, howFound: "", invitedBy: "", notes: "" })).toThrow(ForbiddenError);
    v.addVisit(as("profJ1"), id, "2020-01-12");
    expect(v.listVisitors(as("coordJ"))[0]).toMatchObject({ status: "retornou", visits: 2 });
    expect(v.listVisitors(as("coordA"))).toEqual([]);
    expect(() => v.enrollVisitor(as("secJ"), id, cls.J, "")).toThrow(ForbiddenError); // secretário de sala não matricula
    expect(() => v.enrollVisitor(as("coordJ"), id, cls.A, "")).toThrow(); // coordenador não matricula fora da Escala dele
    const pid = v.enrollVisitor(as("sec"), id, cls.J, "2001-02-03");
    expect(repo.listPeople(as("sec")).find((p) => p.id === pid)?.studentOf).toEqual([cls.J]);
    expect(v.visitorFunnel(as("sec"))).toMatchObject({ total: 1, retornaram: 1, matriculados: 1, pctMatricula: 100 });
    expect(() => v.enrollVisitor(as("sec"), id, cls.J, "")).toThrow(/já matriculado/);
  });

  it("caixa: só ofertas VALIDADAS entram; lançamentos manuais e permissões", async () => {
    const f = await import("./finance");
    validate(L.jPast1, [ids.alunoJ1], 2500);
    repo.saveAttendanceWithCounts(as("secJ"), L.jPast2, [], { visitors: 0, offering_cents: 9900 }); // não validada
    f.createFinanceEntry(as("sec"), { kind: "saida", category: "Lanche", description: "", amountCents: 1000, date: PAST, classId: null, method: "pix" });
    f.createFinanceEntry(as("sec"), { kind: "saida", category: "Material", description: "", amountCents: 300, date: PAST, classId: cls.A, method: "" });
    const rows = f.listFinance(as("sec"), "2020-01-01", "2020-03-31");
    expect(f.financeSummary(rows)).toMatchObject({ entradas: 2500, saidas: 1300, saldo: 1200 });
    // coordenador vê só o que é das classes dele (nem lançamento geral)
    expect(f.listFinance(as("coordJ"), "2020-01-01", "2020-03-31").map((r) => r.category)).toEqual([f.AUTO_OFFERING]);
    expect(() => f.createFinanceEntry(as("coordJ"), { kind: "saida", category: "x", description: "", amountCents: 1, date: PAST, classId: cls.J, method: "" })).toThrow(ForbiddenError);
    expect(() => f.listFinance(as("profJ1"), "2020-01-01", "2020-03-31")).not.toThrow();
    expect(f.listFinance(as("profJ1"), "2020-01-01", "2020-03-31")).toEqual([]);
    expect(() => f.createFinanceEntry(as("sec"), { kind: "saida", category: "x", description: "", amountCents: null, date: PAST, classId: null, method: "" })).toThrow(/valor/);
  });

  it("chamada da equipe: lista a equipe da congregação e ignora quem não é dela", async () => {
    const s = await import("./staffcall");
    const r = s.staffRoster(as("sec"), 1, PAST);
    const names = r.people.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["profJ1", "profJ2", "profA", "secJ", "colabJ", "coordJ", "coordA", "super", "sec"]));
    expect(names).not.toContain("alunoJ1");
    s.saveStaffAttendance(as("sec"), 1, PAST, { [ids.profJ1]: true, [ids.profJ2]: false, [ids.alunoJ1]: true });
    const again = s.staffRoster(as("sec"), 1, PAST);
    expect([again.presentes, again.ausentes]).toEqual([1, 1]);
    expect(db().prepare(`SELECT 1 FROM staff_attendance WHERE person_id=?`).get(ids.alunoJ1)).toBeUndefined(); // quem não é da equipe é ignorado
    expect(() => s.saveStaffAttendance(as("profJ1"), 1, PAST, {})).toThrow(ForbiddenError);
    expect(s.staffRoster(as("coordJ"), 1, PAST).canEdit).toBe(false);
  });

  it("termômetro, professores em destaque e pedido sugerido de revistas", async () => {
    const ins = await import("./insights");
    validate(L.jPast1, [ids.alunoJ1, ids.alunoJ2, ids.profJ1], 100);
    validate(L.jPast2, [ids.alunoJ1], 100);
    const t = ins.classThermometer(as("sec"), "2020-04-01", 1);
    expect(t.find((c) => c.id === cls.J)).toMatchObject({ recent: 50, before: 100, delta: -50, trend: "caindo" });
    const rank = ins.teacherRanking(as("sec"), Q1_2020);
    expect(rank[0]).toMatchObject({ id: ids.profJ1, escaladas: 1, presente: 1, mediaTurma: 100 });
    expect(rank.find((r) => r.id === ids.profJ2)).toMatchObject({ presente: 0, mediaTurma: 50 });
    const sug = ins.magazineSuggestion(as("sec"), Q1_2020).find((s) => s.classId === cls.J)!;
    expect(sug).toMatchObject({ matriculados: 2, mediaPresentes: 1.5, alunos: 2, professores: 2, priceCents: 2000, totalCents: 8000 });
    expect(ins.magazineSuggestion(as("profJ1"), Q1_2020)).toEqual([]);
  });
});

describe("comunicação: comunicados, agenda, mural, notificações e rotinas", () => {
  it("comunicado para uma classe: só quem é dela recebe; professor publica só na sua", async () => {
    const ann = await import("./announcements");
    const n = await import("./notify");
    ann.createAnnouncement(as("profJ1"), { audience: `classe:${cls.J}`, title: "Prova", body: "Domingo", pinned: false, expiresAt: "", notify: true });
    expect(() => ann.createAnnouncement(as("profJ1"), { audience: "todos", title: "x", body: "y", pinned: false, expiresAt: "", notify: false })).toThrow(ForbiddenError);
    expect(() => ann.createAnnouncement(as("profJ1"), { audience: `classe:${cls.A}`, title: "x", body: "y", pinned: false, expiresAt: "", notify: false })).toThrow(ForbiddenError);
    expect(ann.listAnnouncements(as("alunoJ1")).map((a) => a.title)).toEqual(["Prova"]);
    expect(ann.listAnnouncements(as("profA"))).toEqual([]);
    expect(ann.listAnnouncements(as("sec"))).toHaveLength(1); // liderança vê tudo da congregação
    expect(n.unreadCount(as("alunoJ1"))).toBe(1);
    expect(n.unreadCount(as("profA"))).toBe(0);
    expect(n.unreadCount(as("profJ1"))).toBe(0); // quem publicou não é avisado
    ann.markAnnouncementsRead(as("alunoJ1"), ann.listAnnouncements(as("alunoJ1")).map((a) => a.id));
    expect(ann.listAnnouncements(as("profJ1"))[0].reads).toBe(1);
    expect(() => ann.createAnnouncement(as("sec"), { audience: "todos", title: "x", body: "y", pinned: false, expiresAt: "", allCongregations: true, notify: false })).toThrow(/Pastor/);
  });

  it("comunicado para grupo: alunos não veem o da equipe", async () => {
    const ann = await import("./announcements");
    ann.createAnnouncement(as("sec"), { audience: "grupo:equipe", title: "Reunião de professores", body: "Sábado", pinned: false, expiresAt: "", notify: false });
    expect(ann.listAnnouncements(as("alunoJ1"))).toEqual([]);
    expect(ann.listAnnouncements(as("colabJ")).map((a) => a.title)).toEqual(["Reunião de professores"]);
    expect(() => ann.createAnnouncement(as("coordJ"), { audience: "grupo:equipe", title: "x", body: "y", pinned: false, expiresAt: "", notify: false })).toThrow(ForbiddenError);
    expect(() => ann.createAnnouncement(as("coordJ"), { audience: `classe:${cls.J}`, title: "x", body: "y", pinned: false, expiresAt: "", notify: false })).not.toThrow();
  });

  it("agenda: evento, confirmação de presença, .ics e feed pessoal", async () => {
    const ag = await import("./agenda");
    const id = ag.createEvent(as("sec"), { audience: "todos", title: "Confraternização", description: "Traga um prato", location: "Salão", startsAt: "2099-12-20T19:00", endsAt: "", rsvp: true, notify: false });
    expect(() => ag.createEvent(as("sec"), { audience: "todos", title: "x", description: "", location: "", startsAt: "2099-12-20 19h", endsAt: "", rsvp: true, notify: false })).toThrow(/início/);
    ag.answerRsvp(as("alunoJ1"), id, "sim", 2);
    const soA = ag.createEvent(as("sec"), { audience: `classe:${cls.A}`, title: "Só Adultos", description: "", location: "", startsAt: "2099-12-21T19:00", endsAt: "", rsvp: true, notify: false });
    expect(() => ag.answerRsvp(as("alunoJ1"), soA, "sim", 0)).toThrow(ForbiddenError);
    ag.answerRsvp(as("profJ1"), id, "talvez", 5);
    const ev = ag.listEvents(as("alunoJ1"))[0];
    expect(ev).toMatchObject({ mine: "sim", counts: { sim: 1, talvez: 1, nao: 0, guests: 2 }, canEdit: false });
    expect(ag.eventAttendees(as("sec"), id).map((a) => a.answer)).toEqual(["sim", "talvez"]);
    expect(() => ag.eventAttendees(as("alunoJ1"), id)).toThrow(ForbiddenError);
    const ics = ag.eventsIcs([ag.eventForIcs(as("alunoJ1"), id)!], "x");
    expect(ics).toContain("DTSTART;TZID=America/Sao_Paulo:20991220T190000");
    expect(ics).toContain("DTEND;TZID=America/Sao_Paulo:20991220T210000");
    expect(ics).toContain("DESCRIPTION:Traga um prato");
    expect(ag.googleCalendarUrl(ev)).toContain("dates=20991220T190000%2F20991220T210000");
    const tok = ag.calendarToken(as("alunoJ1"));
    expect(ag.feedForToken(tok)).toContain("SUMMARY:Confraternização");
    expect(ag.feedForToken("x".repeat(24))).toBeNull();
    expect(ag.calendarToken(as("alunoJ1"), true)).not.toBe(tok);
    expect(ag.feedForToken(tok)).toBeNull();
  });

  it("mural: aluno publica com aprovação; equipe publica direto; moderação e amém", async () => {
    const m = await import("./mural");
    const n = await import("./notify");
    const a = m.createPost(as("alunoJ1"), { kind: "testemunho", body: "Deus é fiel", image: null, classId: cls.J });
    expect(a.status).toBe("pendente");
    expect(m.listPosts(as("colabJ"))).toEqual([]); // pendente: só autor e moderação
    expect(m.listPosts(as("alunoJ1"))).toHaveLength(1);
    expect(n.unreadCount(as("coordJ"))).toBe(1); // coordenador da classe foi avisado
    expect(() => m.moderatePost(as("profJ1"), a.id, "aprovar")).toThrow(ForbiddenError);
    m.moderatePost(as("coordJ"), a.id, "aprovar");
    expect(m.listPosts(as("colabJ"))).toHaveLength(1);
    m.toggleAmen(as("colabJ"), a.id);
    m.addComment(as("profJ1"), a.id, "Amém!");
    const p = m.listPosts(as("alunoJ1"))[0];
    expect([p.amens, p.comments.length]).toEqual([1, 1]);
    expect(m.createPost(as("profJ1"), { kind: "aviso", body: "Tragam a Bíblia", image: null, classId: null }).status).toBe("publicado");
    expect(() => m.createPost(as("profJ1"), { kind: "foto", body: "", image: null, classId: null })).toThrow(/foto/);
    expect(() => m.deletePost(as("colabJ"), a.id)).toThrow(ForbiddenError);
    m.deletePost(as("alunoJ1"), a.id); // o autor pode excluir
  });

  it("rotinas diárias: aniversário, lembrete do professor (sábado) e ausentes (segunda)", async () => {
    const jobs = await import("./jobs");
    const n = await import("./notify");
    db().prepare(`UPDATE people SET birth_date='2000-03-07' WHERE id=?`).run(ids.alunoJ1);
    db().prepare(`INSERT INTO lessons (class_id, date, teacher_id) VALUES (?, '2020-03-08', ?)`).run(cls.J, ids.profJ2);
    const r = jobs.runDailyJobs("2020-03-07"); // sábado
    expect(r.aniversarios).toBeGreaterThan(0);
    expect(r.escala).toBe(1);
    expect(n.listNotifications(as("alunoJ1"))[0].title).toContain("Feliz aniversário");
    expect(n.listNotifications(as("profJ2")).map((x) => x.title)).toContain("📖 Você está escalado(a) amanhã");
    repo.saveAttendance(as("secJ"), L.jPast1, [ids.alunoJ1]);
    repo.saveAttendance(as("secJ"), L.jPast2, [ids.alunoJ1]);
    db().prepare(`INSERT INTO lessons (class_id, date, teacher_id) VALUES (?, '2020-01-26', ?)`).run(cls.J, ids.profJ1);
    const l3 = (db().prepare(`SELECT id FROM lessons WHERE class_id=? AND date='2020-01-26'`).get(cls.J) as { id: number }).id;
    repo.saveAttendance(as("secJ"), l3, [ids.alunoJ1]);
    expect(jobs.runDailyJobs("2020-01-27").ausentes).toBeGreaterThan(0); // segunda: alunoJ2 faltou 3x
    expect(n.listNotifications(as("coordJ")).some((x) => x.title.includes("3 faltas"))).toBe(true);
  });
});

describe("ensino: lições, plano de aula, quiz, biblioteca, certificados e portal do aluno", () => {
  const validate = (lessonId: number, present: number[]) => {
    repo.saveAttendance(as("secJ"), lessonId, present);
    repo.submitReport(as("secJ"), lessonId);
    repo.validateReport(as("sec"), lessonId);
  };

  it("lições: cola o sumário, liga aos domingos e reorganiza quando um domingo vira 'sem aula'", async () => {
    const t = await import("./teaching");
    expect(() => t.saveCurriculum(as("profJ1"), cls.J, Q1_2020, "1. x")).toThrow(ForbiddenError);
    const n = t.saveCurriculum(as("coordJ"), cls.J, Q1_2020, "1. A Criação | Gn 1 | No princípio\nLição 2 - O Dilúvio\n3) Abraão");
    expect(n).toBe(3);
    const c = t.getCurriculum(as("profJ1"), cls.J, Q1_2020);
    expect(c.map((x) => [x.number, x.title, x.date])).toEqual([[1, "A Criação", PAST], [2, "O Dilúvio", "2020-01-12"], [3, "Abraão", null]]);
    expect(c[0]).toMatchObject({ reading: "Gn 1", golden_text: "No princípio" });
    expect((db().prepare(`SELECT topic FROM lessons WHERE id=?`).get(L.jPast2) as { topic: string }).topic).toBe("Lição 2 — O Dilúvio");
    repo.saveQuarterSchedule(as("coordJ"), cls.J, [{ lessonId: L.jPast1, value: "e:Reunião de Obreiros" }]);
    t.linkCurriculum(cls.J, Q1_2020);
    expect((db().prepare(`SELECT topic FROM lessons WHERE id=?`).get(L.jPast2) as { topic: string }).topic).toBe("Lição 1 — A Criação");
    expect(() => t.saveCurriculum(as("coordJ"), cls.J, Q1_2020, "1. a\n1. b")).toThrow(/repetidos/);
    expect(t.getCurriculum(as("alunoJ1"), cls.J, Q1_2020)).toHaveLength(3);
    expect(() => t.getCurriculum(as("alunoJ1"), cls.A, Q1_2020)).toThrow(ForbiddenError);
  });

  it("plano de aula: só o professor escalado escreve; coordenação acompanha", async () => {
    const t = await import("./teaching");
    t.savePlan(as("profJ1"), L.jPast1, "Objetivo: …");
    expect(() => t.savePlan(as("profJ2"), L.jPast1, "x")).toThrow(ForbiddenError);
    expect(() => t.savePlan(as("coordJ"), L.jPast1, "x")).toThrow(ForbiddenError);
    const plans = t.listPlans(as("coordJ"), "2020-01-01", "2020-01-31");
    expect(plans.find((p) => p.id === L.jPast1)).toMatchObject({ plan: "Objetivo: …", canEdit: false });
    expect(t.listPlans(as("profJ2"), "2020-01-01", "2020-01-31").map((p) => p.id)).toEqual([L.jPast2]); // só as aulas dele
    expect(t.listPlans(as("alunoJ1"), "2020-01-01", "2020-01-31")).toEqual([]);
  });

  it("quiz: professor da classe cria; aluno responde uma vez; pontos = presença + acertos", async () => {
    const z = await import("./quiz");
    const qs = [{ text: "Quem construiu a arca?", options: ["Noé", "Moisés"], correct: 0 }, { text: "Quantos dias choveu?", options: ["7", "40", "12"], correct: 1 }];
    expect(() => z.createQuiz(as("profA"), { classId: cls.J, title: "x", openUntil: "", questions: qs })).toThrow(ForbiddenError);
    expect(() => z.createQuiz(as("profJ1"), { classId: cls.J, title: "x", openUntil: "", questions: [{ text: "a", options: ["só uma"], correct: 0 }] })).toThrow(/duas/);
    const id = z.createQuiz(as("profJ1"), { classId: cls.J, title: "Lição 2", openUntil: "", questions: qs });
    expect(z.getQuiz(as("alunoJ1"), id).questions[0].correct).toBeNull(); // gabarito escondido antes de responder
    expect(z.answerQuiz(as("alunoJ1"), id, [0, 0])).toEqual({ score: 1, total: 2 });
    expect(() => z.answerQuiz(as("alunoJ1"), id, [0, 1])).toThrow(/já respondeu/);
    expect(() => z.answerQuiz(as("profJ1"), id, [0, 1])).toThrow(/alunos da classe/);
    expect(z.getQuiz(as("alunoJ1"), id).questions[1].correct).toBe(1);
    validate(L.jPast1, [ids.alunoJ1]);
    db().prepare(`UPDATE quiz_attempts SET created_at='2020-01-06T10:00:00Z'`).run();
    const scores = z.classScores(as("profJ1"), cls.J, Q1_2020);
    expect(scores[0]).toMatchObject({ id: ids.alunoJ1, presencas: 1, acertos: 1, pontos: 15 });
    const closed = z.createQuiz(as("profJ1"), { classId: cls.J, title: "Velho", openUntil: "2020-01-01", questions: qs });
    expect(() => z.answerQuiz(as("alunoJ1"), closed, [0, 1])).toThrow(/encerrado/);
    expect(z.badges({ presencas: 4, acertos: 12, aulas: 4, pos: 1 })).toEqual(["🏅 Presença 100%", "📚 Estudioso", "🥇 1º lugar da turma"]);
  });

  it("biblioteca: material da equipe não aparece para aluno; material de classe só para a classe; empréstimos", async () => {
    const lib = await import("./library");
    lib.createLibraryItem(as("sec"), { kind: "link", title: "Estudo geral", description: "", author: "", url: "https://ex.com", copies: 1, audience: "todos", classId: null });
    lib.createLibraryItem(as("sec"), { kind: "link", title: "Guia do professor", description: "", author: "", url: "https://ex.com/p", copies: 1, audience: "equipe", classId: null });
    lib.createLibraryItem(as("profJ1"), { kind: "link", title: "Slides Jovens", description: "", author: "", url: "https://ex.com/j", copies: 1, audience: "todos", classId: cls.J });
    expect(() => lib.createLibraryItem(as("profJ1"), { kind: "link", title: "x", description: "", author: "", url: "https://x.com", copies: 1, audience: "todos", classId: null })).toThrow(ForbiddenError);
    expect(() => lib.createLibraryItem(as("sec"), { kind: "link", title: "x", description: "", author: "", url: "javascript:alert(1)", copies: 1, audience: "todos", classId: null })).toThrow(/link/);
    expect(lib.listLibrary(as("alunoJ1")).map((i) => i.title).sort()).toEqual(["Estudo geral", "Slides Jovens"]);
    expect(lib.listLibrary(as("profA")).map((i) => i.title).sort()).toEqual(["Estudo geral", "Guia do professor"]);
    const book = lib.createLibraryItem(as("sec"), { kind: "livro", title: "Manual do Professor", description: "", author: "CPAD", url: "", copies: 1, audience: "todos", classId: null });
    const loan = lib.lendItem(as("sec"), book, ids.profJ1, "2099-01-01");
    expect(() => lib.lendItem(as("sec"), book, ids.profJ2, "2099-01-01")).toThrow(/emprestados/);
    expect(() => lib.lendItem(as("coordJ"), book, ids.profJ2, "2099-01-01")).toThrow(ForbiddenError);
    expect(lib.listLoans(as("profJ1")).map((l) => l.title)).toEqual(["Manual do Professor"]);
    expect(lib.listLoans(as("profJ2"))).toEqual([]);
    lib.returnLoan(as("sec"), loan);
    expect(() => lib.lendItem(as("sec"), book, ids.profJ2, "2099-01-01")).not.toThrow();
  });

  it("certificados e portal do aluno", async () => {
    const cert = await import("./certificates");
    const portal = await import("./portal");
    validate(L.jPast1, [ids.alunoJ1]);
    validate(L.jPast2, [ids.alunoJ1, ids.alunoJ2]);
    const apt = cert.eligibleStudents(as("coordJ"), Q1_2020);
    expect(apt.map((r) => [r.person_id, r.pct])).toEqual([[ids.alunoJ1, 100]]); // alunoJ2 tem 50%
    expect(cert.eligibleStudents(as("coordJ"), Q1_2020, 50).map((r) => r.person_id).sort()).toEqual([ids.alunoJ1, ids.alunoJ2].sort());
    expect(() => cert.eligibleStudents(as("profJ1"), Q1_2020)).toThrow(ForbiddenError);
    expect(cert.myCertificates(as("alunoJ1"), Q1_2020)).toHaveLength(1);
    const p = portal.studentPortal(as("alunoJ1"), "2020-03-01")!;
    expect(p.classes[0]).toMatchObject({ presentes: 2, total: 2, pct: 100, pontos: 20, pos: 1 });
    expect(p.classes[0].badges).toContain("🏅 Presença 100%");
    expect(portal.studentPortal(as("profJ1"))).toBeNull();
  });
});

describe("extras: importação por planilha, login com Google e pedido de nova senha", () => {
  it("importa CSV (; ou ,), aceita dd/mm/aaaa, detecta erros e não duplica", async () => {
    const im = await import("./importer");
    expect(im.parseCsv('nome,classe\n"Silva, Ana",Jovens\n')).toEqual([["nome", "classe"], ["Silva, Ana", "Jovens"]]);
    const csv = "Nome;Nascimento;Telefone;Responsável;E-mail;Classe\nAna Lima;15/03/2012;(11) 1;Rosa;ana@x.com;jovens\nalunoJ1;15/06/2000;;;;Jovens\nSem Data;31/02/2010;;;;Jovens\n;;;;;\nBeto;01/01/1990;;;;Inexistente\nAna Lima;15/03/2012;;;;Jovens\n";
    const pv = im.previewImport(as("sec"), csv);
    expect(pv.map((r) => r.status)).toEqual(["novo", "existente", "erro", "erro", "erro"]);
    expect(pv[0]).toMatchObject({ birth: "2012-03-15", classId: cls.J });
    expect(pv[3].error).toMatch(/não encontrada/);
    expect(pv[4].error).toMatch(/repetida/);
    const r = im.runImport(as("sec"), csv);
    expect(r).toEqual({ criados: 1, matriculados: 0, erros: 3 }); // alunoJ1 já existe e já é da classe
    expect(im.runImport(as("sec"), csv)).toEqual({ criados: 0, matriculados: 0, erros: 3 }); // segunda vez: nada novo
    const ana = repo.listPeople(as("sec")).find((p) => p.name === "Ana Lima")!;
    expect(ana).toMatchObject({ studentOf: [cls.J], email: "ana@x.com", birth_date: "2012-03-15" });
    expect(() => im.runImport(as("profJ1"), csv)).toThrow(ForbiddenError);
    expect(im.previewImport(as("coordJ"), "nome;classe\nX;Adultos")[0].status).toBe("erro"); // classe fora do escopo
  });

  it("Google: vincula pelo e-mail verificado; nunca cria acesso novo", async () => {
    const g = await import("./google");
    const sub = "g-123";
    expect(g.userForGoogle({ sub, email: "PROFJ1@t.local", email_verified: true })).toBe(ids.u_profJ1);
    expect(g.userForGoogle({ sub, email: "outro@t.local", email_verified: true })).toBe(ids.u_profJ1); // já vinculado pelo sub
    expect(g.userForGoogle({ sub: "g-999", email: "profj1@t.local", email_verified: true })).toBeNull(); // conta já ligada a outro Google
    expect(g.userForGoogle({ sub: "g-2", email: "sec@t.local", email_verified: false })).toBeNull();
    expect(g.userForGoogle({ sub: "g-3", email: "naoexiste@t.local", email_verified: true })).toBeNull();
    const fake = (async (url: string) =>
      url.includes("token") ? new Response(JSON.stringify({ access_token: "abc" })) : new Response(JSON.stringify({ sub: "s", email: "a@b.c", email_verified: true }))) as typeof fetch;
    expect(await g.exchangeCode("code", "http://x/cb", fake)).toMatchObject({ sub: "s", email: "a@b.c" });
    expect(g.googleAuthUrl("http://x/cb", "st")).toContain("scope=openid+email+profile");
  });

  it("esqueci a senha: avisa a superintendência, sem revelar e com limite de frequência", async () => {
    const rs = await import("./reset");
    const n = await import("./notify");
    rs.requestPasswordReset("alunoj1@t.local", 1_000_000);
    rs.requestPasswordReset("alunoj1@t.local", 1_000_000 + 60_000); // repetido em 1 min: ignorado
    rs.requestPasswordReset("ninguem@t.local", 1_000_000);
    expect(n.listNotifications(as("super")).filter((x) => x.title.includes("redefinir"))).toHaveLength(1);
    expect(n.unreadCount(as("sec"))).toBe(0);
  });
});
