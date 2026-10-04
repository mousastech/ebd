/**
 * Biblioteca da EBD: materiais digitais (PDF, slides, imagens), links (vídeos, estudos) e o acervo físico
 * de livros com controle de empréstimos. Materiais "da equipe" não aparecem para alunos.
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { isISODate, todayISO } from "./format";
import { listClasses, UserError } from "./repo";
import { removeUpload } from "./uploads";

type Id = number;
export type ItemKind = "arquivo" | "link" | "livro";
export interface LibraryItem {
  id: Id;
  congregation_id: Id;
  class_id: Id | null;
  class_name: string | null;
  kind: ItemKind;
  title: string;
  description: string | null;
  author: string | null;
  file: string | null;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  url: string | null;
  copies: number;
  audience: "todos" | "equipe";
  on_loan: number;
  created_at: string;
  canEdit: boolean;
  canLend: boolean;
}

const lres = (i: { congregation_id: Id; class_id: Id | null }): Resource => ({
  type: "library", congregationId: i.congregation_id, classIds: i.class_id ? [i.class_id] : [],
});
const isTeam = (u: Subject) => u.role !== "aluno" || u.secretaryOf.length > 0;
const reach = (u: Subject, cong: Id) => u.congregations == null || u.congregations.includes(cong);

function visible(u: Subject, i: { congregation_id: Id; class_id: Id | null; audience: string }, myClasses: Set<Id>): boolean {
  if (!reach(u, i.congregation_id) || !can(u, "read", lres(i))) return false;
  if (i.audience === "equipe" && !isTeam(u)) return false;
  if (i.class_id && !myClasses.has(i.class_id)) return false; // material de classe: quem tem acesso à classe
  return true;
}

export function listLibrary(u: Subject, opts: { kind?: ItemKind; q?: string } = {}): LibraryItem[] {
  const myClasses = new Set(listClasses({ ...u, view: null }).map((c) => c.id));
  const rows = db()
    .prepare(`SELECT i.*, c.name AS class_name,
                     (SELECT COUNT(*) FROM loans l WHERE l.item_id=i.id AND l.returned_at IS NULL) AS on_loan
                FROM library_items i LEFT JOIN classes c ON c.id=i.class_id ORDER BY i.id DESC`)
    .all() as Omit<LibraryItem, "canEdit" | "canLend">[];
  const q = opts.q?.trim().toLowerCase();
  return rows
    .filter((i) => (u.view == null || i.congregation_id === u.view) && visible(u, i, myClasses))
    .filter((i) => !opts.kind || i.kind === opts.kind)
    .filter((i) => !q || `${i.title} ${i.author ?? ""} ${i.description ?? ""}`.toLowerCase().includes(q))
    .map((i) => ({ ...i, canEdit: can(u, "update", lres(i)), canLend: i.kind === "livro" && can(u, "create", { type: "loan", congregationId: i.congregation_id }) }));
}

export function createLibraryItem(
  u: Subject,
  d: { kind: string; title: string; description: string; author: string; url: string; copies: number; audience: string; classId: Id | null;
    file?: { rel: string; mime: string; size: number; originalName: string } | null },
): Id {
  const kind = (["arquivo", "link", "livro"] as const).find((k) => k === d.kind);
  if (!kind) throw new UserError("Tipo inválido.");
  const cong = d.classId
    ? ((db().prepare(`SELECT congregation_id FROM classes WHERE id=?`).get(d.classId) as { congregation_id: Id } | undefined)?.congregation_id ?? null)
    : u.view ?? u.home ?? 1;
  if (cong === null) throw new UserError("Classe não encontrada.");
  authorize(u, "create", lres({ congregation_id: cong, class_id: d.classId }));
  if (!d.title.trim()) throw new UserError("Informe o título.");
  if (kind === "arquivo" && !d.file) throw new UserError("Escolha o arquivo.");
  if (kind === "link" && !/^https?:\/\/\S+$/.test(d.url.trim())) throw new UserError("Informe um link válido (https://…).");
  return Number(
    db()
      .prepare(`INSERT INTO library_items (congregation_id, class_id, kind, title, description, author, file, file_name, mime, size, url, copies, audience, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cong, d.classId, kind, d.title.trim().slice(0, 160), d.description.trim() || null, d.author.trim() || null,
        d.file?.rel ?? null, d.file?.originalName ?? null, d.file?.mime ?? null, d.file?.size ?? null,
        kind === "link" ? d.url.trim() : null, kind === "livro" ? Math.max(1, Math.min(99, Math.trunc(d.copies || 1))) : 1,
        d.audience === "equipe" ? "equipe" : "todos", u.personId, new Date().toISOString())
      .lastInsertRowid,
  );
}

function item(id: Id) {
  const i = db().prepare(`SELECT * FROM library_items WHERE id=?`).get(id) as
    | { id: Id; congregation_id: Id; class_id: Id | null; kind: ItemKind; file: string | null; copies: number; title: string; audience: string } | undefined;
  if (!i) throw new UserError("Item não encontrado.");
  return i;
}

export function deleteLibraryItem(u: Subject, id: Id): void {
  const i = item(id);
  authorize(u, "delete", lres(i));
  db().prepare(`DELETE FROM library_items WHERE id=?`).run(id);
  removeUpload(i.file);
}

/** Arquivos da biblioteca só para quem pode ver o item. */
export function canReadLibraryFile(u: Subject, rel: string): boolean {
  const i = db().prepare(`SELECT congregation_id, class_id, audience FROM library_items WHERE file=?`).get(rel) as
    | { congregation_id: Id; class_id: Id | null; audience: string } | undefined;
  if (!i) return false;
  return visible(u, i, new Set(listClasses({ ...u, view: null }).map((c) => c.id)));
}

// ───────────────────────────── empréstimos do acervo
export interface LoanRow {
  id: Id;
  item_id: Id;
  title: string;
  person_id: Id;
  person: string;
  loaned_at: string;
  due_at: string;
  returned_at: string | null;
  late: boolean;
}

export function listLoans(u: Subject, opts: { open?: boolean } = {}): LoanRow[] {
  const today = todayISO();
  const rows = db()
    .prepare(`SELECT l.id, l.item_id, i.title, l.person_id, p.name AS person, l.loaned_at, l.due_at, l.returned_at, i.congregation_id
                FROM loans l JOIN library_items i ON i.id=l.item_id JOIN people p ON p.id=l.person_id
               ${opts.open ? "WHERE l.returned_at IS NULL" : ""} ORDER BY l.returned_at IS NOT NULL, l.due_at`)
    .all() as (Omit<LoanRow, "late"> & { congregation_id: Id })[];
  return rows
    .filter((l) => (u.view == null || l.congregation_id === u.view) && can(u, "read", { type: "loan", congregationId: l.congregation_id, personId: l.person_id }))
    .map(({ congregation_id: _c, ...l }) => ({ ...l, late: !l.returned_at && l.due_at < today }));
}

export function lendItem(u: Subject, itemId: Id, personId: Id, dueAt: string): Id {
  const i = item(itemId);
  if (i.kind !== "livro") throw new UserError("Só livros do acervo são emprestados.");
  authorize(u, "create", { type: "loan", congregationId: i.congregation_id });
  if (!isISODate(dueAt) || dueAt < todayISO()) throw new UserError("Informe a data de devolução.");
  const p = db().prepare(`SELECT congregation_id FROM people WHERE id=? AND active=1`).get(personId) as { congregation_id: Id } | undefined;
  if (!p) throw new UserError("Pessoa não encontrada.");
  const out = (db().prepare(`SELECT COUNT(*) n FROM loans WHERE item_id=? AND returned_at IS NULL`).get(itemId) as { n: number }).n;
  if (out >= i.copies) throw new UserError("Todos os exemplares estão emprestados.");
  return Number(
    db().prepare(`INSERT INTO loans (item_id, person_id, loaned_at, due_at, created_by) VALUES (?, ?, ?, ?, ?)`)
      .run(itemId, personId, todayISO(), dueAt, u.personId).lastInsertRowid,
  );
}

export function returnLoan(u: Subject, loanId: Id): void {
  const l = db().prepare(`SELECT l.returned_at, i.congregation_id FROM loans l JOIN library_items i ON i.id=l.item_id WHERE l.id=?`).get(loanId) as
    | { returned_at: string | null; congregation_id: Id } | undefined;
  if (!l) throw new UserError("Empréstimo não encontrado.");
  authorize(u, "update", { type: "loan", congregationId: l.congregation_id });
  if (l.returned_at) throw new UserError("Este livro já foi devolvido.");
  db().prepare(`UPDATE loans SET returned_at=? WHERE id=?`).run(todayISO(), loanId);
}
