import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_SCHEMA_FOR_TESTS, openDb, SCHEMA_VERSION } from "./db";

describe("migrações do banco", () => {
  it("um banco da versão 3 (primeira entrega) é atualizado sem perder dados", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ebd-")), "v3.db");
    const old = new Database(file);
    old.exec(BASE_SCHEMA_FOR_TESTS);
    old.pragma("user_version = 3");
    old.exec(`INSERT INTO people (id, name) VALUES (1, 'Roberto'), (2, 'Rivanildo');
              INSERT INTO users (person_id, email, password_hash, role) VALUES (1, 'super@x', 'h', 'superintendente');
              INSERT INTO class_groups (id, name, coordinator_id) VALUES (1, 'Escala 1', 2);
              INSERT INTO classes (id, name, group_id) VALUES (1, 'Betel', 1);
              INSERT INTO lessons (class_id, date, offering_cents) VALUES (1, '2026-07-05', 1500);`);
    old.close();

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare(`SELECT role FROM users`).get()).toEqual({ role: "superintendente" });
    expect(db.prepare(`SELECT name, coordinator_id, congregation_id FROM class_groups`).get()).toEqual({ name: "Escala 1", coordinator_id: 2, congregation_id: 1 });
    expect(db.prepare(`SELECT congregation_id FROM classes`).get()).toEqual({ congregation_id: 1 });
    expect(db.prepare(`SELECT offering_cents FROM lessons`).get()).toEqual({ offering_cents: 1500 });
    expect(db.prepare(`SELECT name, kind FROM congregations`).get()).toEqual({ name: "Sede", kind: "sede" });
    // novas funções aceitas e chaves estrangeiras íntegras
    db.prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (2, 'p@x', 'h', 'pastor')`).run();
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
    // reabrir não reaplica nada
    expect(() => openDb(file).close()).not.toThrow();
  });

  it("recusa banco de versão mais nova que o sistema", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ebd-")), "novo.db");
    const d = new Database(file);
    d.exec(BASE_SCHEMA_FOR_TESTS);
    d.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    d.close();
    expect(() => openDb(file)).toThrow(/mais nova/);
  });
});
