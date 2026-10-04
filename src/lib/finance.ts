/**
 * Caixa da EBD. Entradas automáticas: ofertas das aulas VALIDADAS e pagamentos de revistas.
 * Entradas e saídas manuais: doações, cantina, compra de revistas, lanches, eventos…
 * Escopo: congregação (e classe, para o coordenador).
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { isISODate } from "./format";
import { UserError } from "./repo";

type Id = number;
export const IN_CATEGORIES = ["Oferta extra", "Doação", "Cantina", "Venda avulsa de revistas", "Outras entradas"];
export const OUT_CATEGORIES = ["Compra de revistas", "Material didático", "Lanche / confraternização", "Premiação / brindes", "Eventos", "Manutenção", "Outras saídas"];
export const AUTO_OFFERING = "Ofertas das aulas";
export const AUTO_MAGAZINES = "Pagamentos de revistas";

export interface FinanceRow {
  id: string; // "m12" manual, "o34" oferta, "p56" pagamento
  manual: boolean;
  kind: "entrada" | "saida";
  category: string;
  description: string | null;
  amount_cents: number;
  date: string;
  class_id: Id | null;
  class_name: string | null;
  congregation_id: Id;
  canDelete: boolean;
}

const fres = (r: { class_id: Id | null; congregation_id: Id }): Resource => ({
  type: "finance", classIds: r.class_id ? [r.class_id] : [], congregationId: r.congregation_id,
});

export function listFinance(u: Subject, from: string, to: string): FinanceRow[] {
  const manual = db()
    .prepare(`SELECT f.id, f.kind, f.category, f.description, f.amount_cents, f.date, f.class_id, c.name AS class_name, f.congregation_id
                FROM finance_entries f LEFT JOIN classes c ON c.id=f.class_id WHERE f.date BETWEEN ? AND ?`)
    .all(from, to) as Omit<FinanceRow, "id" | "manual" | "canDelete"> & { id: number }[];
  const offerings = db()
    .prepare(`SELECT l.id, l.offering_cents AS amount_cents, l.date, l.class_id, c.name AS class_name, c.congregation_id
                FROM lessons l JOIN classes c ON c.id=l.class_id
               WHERE l.report_status='validada' AND l.offering_cents > 0 AND l.date BETWEEN ? AND ?`)
    .all(from, to) as { id: Id; amount_cents: number; date: string; class_id: Id; class_name: string; congregation_id: Id }[];
  const payments = db()
    .prepare(`SELECT pay.id, pay.amount_cents, pay.paid_at AS date, o.class_id, c.name AS class_name, pe.congregation_id, m.title
                FROM payments pay JOIN material_orders o ON o.id=pay.order_id JOIN materials m ON m.id=o.material_id
                JOIN people pe ON pe.id=o.person_id LEFT JOIN classes c ON c.id=o.class_id
               WHERE pay.paid_at BETWEEN ? AND ?`)
    .all(from, to) as { id: Id; amount_cents: number; date: string; class_id: Id | null; class_name: string | null; congregation_id: Id; title: string }[];

  const rows: FinanceRow[] = [
    ...(manual as unknown as (Omit<FinanceRow, "id" | "manual" | "canDelete"> & { id: number })[]).map((m) => ({
      ...m, id: `m${m.id}`, manual: true, canDelete: can(u, "delete", fres(m)),
    })),
    ...offerings.map((o) => ({
      id: `o${o.id}`, manual: false, kind: "entrada" as const, category: AUTO_OFFERING, description: "Aula validada",
      amount_cents: o.amount_cents, date: o.date, class_id: o.class_id, class_name: o.class_name, congregation_id: o.congregation_id, canDelete: false,
    })),
    ...payments.map((p) => ({
      id: `p${p.id}`, manual: false, kind: "entrada" as const, category: AUTO_MAGAZINES, description: p.title,
      amount_cents: p.amount_cents, date: p.date, class_id: p.class_id, class_name: p.class_name, congregation_id: p.congregation_id, canDelete: false,
    })),
  ];
  return rows
    .filter((r) => u.view == null || r.congregation_id === u.view)
    .filter((r) => can(u, "read", fres(r)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function financeSummary(rows: FinanceRow[]) {
  const sum = (f: (r: FinanceRow) => boolean) => rows.filter(f).reduce((n, r) => n + r.amount_cents, 0);
  const entradas = sum((r) => r.kind === "entrada");
  const saidas = sum((r) => r.kind === "saida");
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const byMonth = months.map((m) => ({
    month: m,
    entradas: sum((r) => r.kind === "entrada" && r.date.startsWith(m)),
    saidas: sum((r) => r.kind === "saida" && r.date.startsWith(m)),
  }));
  const cats = [...new Set(rows.map((r) => `${r.kind}|${r.category}`))];
  const byCategory = cats
    .map((k) => {
      const [kind, category] = k.split("|") as ["entrada" | "saida", string];
      return { kind, category, total: sum((r) => r.kind === kind && r.category === category) };
    })
    .sort((a, b) => b.total - a.total);
  const classes = [...new Set(rows.filter((r) => r.class_id).map((r) => r.class_name!))];
  const byClass = classes
    .map((name) => ({
      name,
      entradas: sum((r) => r.class_name === name && r.kind === "entrada"),
      saidas: sum((r) => r.class_name === name && r.kind === "saida"),
    }))
    .sort((a, b) => b.entradas - a.entradas);
  return { entradas, saidas, saldo: entradas - saidas, byMonth, byCategory, byClass };
}

export function createFinanceEntry(
  u: Subject,
  d: { kind: string; category: string; description: string; amountCents: number | null; date: string; classId: Id | null; method: string },
): Id {
  if (d.kind !== "entrada" && d.kind !== "saida") throw new UserError("Tipo inválido.");
  const cong = d.classId
    ? ((db().prepare(`SELECT congregation_id FROM classes WHERE id=?`).get(d.classId) as { congregation_id: Id } | undefined)?.congregation_id ?? null)
    : u.view ?? u.home ?? 1;
  if (cong === null) throw new UserError("Classe não encontrada.");
  authorize(u, "create", fres({ class_id: d.classId, congregation_id: cong }));
  if (!d.category.trim()) throw new UserError("Informe a categoria.");
  if (!d.amountCents || d.amountCents <= 0) throw new UserError("Informe um valor maior que zero (use 25,50).");
  if (!isISODate(d.date)) throw new UserError("Data inválida.");
  return Number(
    db()
      .prepare(`INSERT INTO finance_entries (congregation_id, class_id, kind, category, description, amount_cents, date, method, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cong, d.classId, d.kind, d.category.trim().slice(0, 60), d.description.trim() || null, d.amountCents, d.date,
        d.method.trim() || null, u.personId, new Date().toISOString())
      .lastInsertRowid,
  );
}

export function deleteFinanceEntry(u: Subject, id: Id): void {
  const r = db().prepare(`SELECT class_id, congregation_id FROM finance_entries WHERE id=?`).get(id) as
    | { class_id: Id | null; congregation_id: Id } | undefined;
  if (!r) throw new UserError("Lançamento não encontrado.");
  authorize(u, "delete", fres(r));
  db().prepare(`DELETE FROM finance_entries WHERE id=?`).run(id);
}
