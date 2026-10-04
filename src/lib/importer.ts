/**
 * Importação de pessoas por planilha (CSV exportado do Excel/Google Planilhas).
 * Colunas reconhecidas (em qualquer ordem, com ou sem acento): nome, nascimento, telefone, responsável, e-mail, classe.
 * Quem já existe (mesmo nome e nascimento) não é duplicado: apenas é matriculado na classe, se ainda não for.
 */
import { authorize, can, type Subject } from "./abac";
import { db } from "./db";
import { isISODate } from "./format";
import { createPerson, enrollStudent, listClasses, UserError } from "./repo";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/)[0] ?? "";
  const sep = [";", "\t", ","].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADERS: Record<string, string[]> = {
  name: ["nome", "nome completo", "aluno", "name"],
  birth: ["nascimento", "data de nascimento", "data nascimento", "aniversario", "dt nascimento"],
  phone: ["telefone", "celular", "whatsapp", "fone", "contato"],
  guardian: ["responsavel", "nome do responsavel", "pai/mae", "pais"],
  email: ["email", "e-mail"],
  klass: ["classe", "turma", "sala"],
};

function toISO(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (isISODate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (!m) return "invalid";
  const y = m[3].length === 2 ? (Number(m[3]) > 30 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
  const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isISODate(iso) ? iso : "invalid";
}

export interface ImportRow {
  line: number;
  name: string;
  birth: string | null;
  phone: string;
  guardian: string;
  email: string;
  className: string;
  classId: number | null;
  status: "novo" | "existente" | "erro";
  error?: string;
}

export function previewImport(u: Subject, text: string): ImportRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new UserError("A planilha precisa de um cabeçalho e ao menos uma linha.");
  const head = rows[0].map(norm);
  const col = (k: string) => head.findIndex((h) => HEADERS[k].includes(h));
  const idx = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.name < 0) throw new UserError("Não encontrei a coluna “nome” no cabeçalho.");
  const classes = listClasses(u).filter((c) => can(u, "create", { type: "enrollment", classIds: [c.id] }));
  const byName = new Map(classes.map((c) => [norm(c.name), c.id]));
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
  const cong = u.view ?? u.home ?? 1;
  const seen = new Set<string>();
  return rows.slice(1).map((r, i) => {
    const name = get(r, "name").replace(/\s+/g, " ");
    const birth = toISO(get(r, "birth"));
    const className = get(r, "klass");
    const classId = className ? byName.get(norm(className)) ?? null : null;
    const base = { line: i + 2, name, birth: birth === "invalid" ? null : birth, phone: get(r, "phone"), guardian: get(r, "guardian"), email: get(r, "email"), className, classId };
    const err = (error: string): ImportRow => ({ ...base, status: "erro", error });
    if (!name) return err("sem nome");
    if (name.length > 120) return err("nome muito longo");
    if (birth === "invalid") return err("data de nascimento inválida (use dd/mm/aaaa)");
    if (className && classId === null) return err(`classe “${className}” não encontrada (ou sem permissão)`);
    const key = `${norm(name)}|${birth ?? ""}`;
    if (seen.has(key)) return err("linha repetida na planilha");
    seen.add(key);
    const existing = db()
      .prepare(`SELECT id FROM people WHERE active=1 AND congregation_id=? AND lower(name)=lower(?) AND COALESCE(birth_date,'')=?`)
      .get(cong, name, birth ?? "") as { id: number } | undefined;
    return { ...base, status: existing ? "existente" : "novo" };
  });
}

/** Importa as linhas válidas. Retorna quantos foram criados e quantos já existiam (e foram só matriculados). */
export function runImport(u: Subject, text: string): { criados: number; matriculados: number; erros: number } {
  authorize(u, "create", { type: "person", congregationId: u.view ?? u.home ?? 1 });
  const rows = previewImport(u, text);
  let criados = 0, matriculados = 0;
  const cong = u.view ?? u.home ?? 1;
  db().transaction(() => {
    for (const r of rows) {
      if (r.status === "erro") continue;
      if (r.status === "novo") {
        const id = createPerson(u, { name: r.name, birth_date: r.birth ?? "", phone: r.phone, guardian_name: r.guardian, classId: r.classId ?? undefined });
        if (r.email && /^\S+@\S+\.\S+$/.test(r.email)) db().prepare(`UPDATE people SET email=? WHERE id=?`).run(r.email.toLowerCase(), id);
        criados++;
      } else if (r.classId) {
        const p = db().prepare(`SELECT id FROM people WHERE active=1 AND congregation_id=? AND lower(name)=lower(?) AND COALESCE(birth_date,'')=?`)
          .get(cong, r.name, r.birth ?? "") as { id: number };
        const before = db().prepare(`SELECT 1 FROM enrollments WHERE class_id=? AND person_id=?`).get(r.classId, p.id);
        if (!before) { enrollStudent(u, r.classId, p.id); matriculados++; }
      }
    }
  })();
  return { criados, matriculados, erros: rows.filter((r) => r.status === "erro").length };
}

export const TEMPLATE_CSV = "﻿nome;nascimento;telefone;responsável;e-mail;classe\r\nMaria da Silva;15/03/2012;(11) 90000-0000;Ana da Silva;;Campeões de Cristo\r\nJoão Souza;02/07/1985;(11) 91111-1111;;joao@exemplo.com;Atalaias\r\n";
