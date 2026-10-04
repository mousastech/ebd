import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "./abac";
import * as church from "./church";
import { db, openDb } from "./db";
import { loadSubject } from "./subject";

let U: Record<string, number>;
const as = (k: string) => loadSubject(U[k])!;

beforeEach(() => {
  globalThis.__ebdDb = openDb(":memory:");
  const d = db();
  const F = Number(d.prepare(`INSERT INTO congregations (name) VALUES ('Filial')`).run().lastInsertRowid);
  const mk = (name: string, role: string, cong = 1) => {
    const pid = Number(d.prepare(`INSERT INTO people (name, congregation_id) VALUES (?, ?)`).run(name, cong).lastInsertRowid);
    return Number(d.prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (?, ?, 'x', ?)`).run(pid, `${name}@t`, role).lastInsertRowid);
  };
  U = { pastor: mk("pastor", "pastor"), sup: mk("sup", "supervisor"), superS: mk("superS", "superintendente"), superF: mk("superF", "superintendente", F), prof: mk("prof", "professor"), F };
});

describe("congregações e dados da igreja", () => {
  it("só o Pastor cria filiais e define a região dos supervisores", () => {
    expect(() => church.createCongregation(as("superS"), { name: "X", region: "", address: "" })).toThrow(ForbiddenError);
    const id = church.createCongregation(as("pastor"), { name: "Nova", region: "Sul", address: "" });
    expect(church.listCongregations(as("pastor")).map((c) => c.name)).toContain("Nova");
    expect(() => church.createCongregation(as("pastor"), { name: "Nova", region: "", address: "" })).toThrow(/Já existe/);
    church.setSupervisorCongregations(as("pastor"), U.sup, [id, U.F]);
    expect(as("sup").congregations?.sort()).toEqual([id, U.F].sort());
    expect(() => church.setSupervisorCongregations(as("superS"), U.sup, [1])).toThrow(ForbiddenError);
    expect(() => church.setSupervisorCongregations(as("pastor"), U.prof, [1])).toThrow(/supervisor/);
  });

  it("cada usuário enxerga só as suas congregações", () => {
    expect(church.listCongregations(as("superF")).map((c) => c.id)).toEqual([U.F]);
    expect(church.listCongregations(as("pastor"))).toHaveLength(2);
    expect(church.listCongregations(as("prof"))).toEqual([]);
  });

  it("dados da igreja: Pastor e superintendente da sede; filial não", () => {
    church.saveSettings(as("superS"), { church_name: "Igreja X", lema: "Lema" });
    expect(church.getSettings()).toMatchObject({ church_name: "Igreja X", lema: "Lema" });
    expect(() => church.saveSettings(as("superF"), { church_name: "Y" })).toThrow(ForbiddenError);
    expect(() => church.saveSettings(as("prof"), { church_name: "Y" })).toThrow(ForbiddenError);
    church.saveSettings(as("pastor"), { church_name: "Z", logo: "x" } as never);
    expect(church.getSettings()).toMatchObject({ church_name: "Z", logo: null });
  });

  it("foto: a própria sempre; a de outros só com permissão de editar o cadastro", () => {
    const profPerson = (db().prepare(`SELECT person_id p FROM users WHERE id=?`).get(U.prof) as { p: number }).p;
    church.setPersonPhoto(as("prof"), profPerson, "photos/aaaaaaaaaaaaaaaaaaaaaaaa.jpg");
    expect(as("prof").photo).toBe("photos/aaaaaaaaaaaaaaaaaaaaaaaa.jpg");
    const pastorPerson = (db().prepare(`SELECT person_id p FROM users WHERE id=?`).get(U.pastor) as { p: number }).p;
    expect(() => church.setPersonPhoto(as("prof"), pastorPerson, null)).toThrow(ForbiddenError);
    expect(() => church.setPersonPhoto(as("superS"), pastorPerson, null)).not.toThrow();
  });
});
