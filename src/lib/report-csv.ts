import { monthName, quarterLabel } from "./format";
import { frequency, type Consolidated, type Tally } from "./repo";

const q = (v: string | number): string => `"${String(v).replace(/"/g, '""')}"`;
const num = (n: number | null): string => (n === null ? "" : String(n).replace(".", ","));
const money = (cents: number): string => (cents / 100).toFixed(2).replace(".", ",");

const row = (cells: (string | number)[]): string => cells.join(";");

/**
 * CSV do relatório consolidado, no padrão do Excel em português (separador ";", decimal ",", BOM UTF-8).
 * Uma linha por classe e mês, mais o total de cada classe e o total geral da EBD.
 */
export function consolidatedCsv(c: Consolidated, groupName: (groupId: number | null) => string): string {
  const header = [
    "Escala", "Classe", "Período", "Aulas programadas", "Aulas validadas", "Pendências", "Alunos presentes",
    "Registros de alunos", "Frequência dos alunos (%)", "Professores presentes", "Registros de professores",
    "Visitantes", "Oferta (R$)",
  ];
  const line = (escala: string, classe: string, periodo: string, t: Tally) =>
    row([
      q(escala), q(classe), q(periodo), t.aulasProgramadas, t.aulasValidadas, t.pendencias, t.alunosPresentes,
      t.alunosRegistros, num(frequency(t)), t.professoresPresentes, t.professoresRegistros, t.visitantes, money(t.ofertaCents),
    ]);
  const lines = [row(header.map(q))];
  for (const k of c.classes) {
    const escala = groupName(k.cls.group_id);
    for (const m of k.months) lines.push(line(escala, k.cls.name, monthName(m.month), m.tally));
    lines.push(line(escala, k.cls.name, `Total ${quarterLabel(c.quarter)}`, k.total));
  }
  for (const m of c.months) lines.push(line("EBD", "Todas as classes", monthName(m.month), m.tally));
  lines.push(line("EBD", "Todas as classes", `Total ${quarterLabel(c.quarter)}`, c.total));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

const BOM = "﻿";
const csv = (header: string[], rows: (string | number)[][]): string =>
  BOM + [row(header.map(q)), ...rows.map(row)].join("\r\n") + "\r\n";

/** Frequência individual (alunos e professores) por classe no trimestre. */
export function frequencyCsv(
  items: { escala: string; classe: string; tipo: "Aluno" | "Professor"; nome: string; presentes: number; total: number; pct: number | null }[],
): string {
  return csv(
    ["Escala", "Classe", "Tipo", "Nome", "Presenças", "Aulas", "Frequência (%)"],
    items.map((i) => [q(i.escala), q(i.classe), q(i.tipo), q(i.nome), i.presentes, i.total, num(i.pct)]),
  );
}

/** Revistas por aluno com valores pagos e saldo. */
export function materialsCsv(
  orders: { material_title: string; period: string | null; class_name: string | null; person_name: string; price_cents: number; paid_cents: number; balance_cents: number }[],
): string {
  return csv(
    ["Revista", "Período", "Classe", "Aluno", "Valor (R$)", "Pago (R$)", "Saldo (R$)", "Situação"],
    orders.map((o) => [
      q(o.material_title), q(o.period ?? ""), q(o.class_name ?? ""), q(o.person_name),
      money(o.price_cents), money(o.paid_cents), money(o.balance_cents), q(o.balance_cents === 0 ? "Quitada" : "Em aberto"),
    ]),
  );
}

/** Lista de chamada em branco (frequência manual) para preencher no Excel. */
export function rosterCsv(
  sheets: { cls: { name: string }; dates: { date: string; lesson: { kind: string; event_label: string | null } | null }[]; students: { name: string }[] }[],
): string {
  const lines: string[] = [];
  for (const s of sheets) {
    const head = ["Classe", "Aluno", ...s.dates.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)}${d.lesson?.kind === "evento" ? ` (${d.lesson.event_label})` : ""}`)];
    lines.push(row(head.map(q)));
    for (const st of s.students) lines.push(row([q(s.cls.name), q(st.name), ...s.dates.map(() => "")]));
    lines.push("");
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Alunos ausentes nas últimas aulas, com contato quando permitido. */
export function absenteesCsv(
  items: { class_name: string; name: string; faltas: number; lastPresent: string | null; phone: string | null; guardian_name: string | null }[],
): string {
  return csv(
    ["Classe", "Aluno", "Faltas seguidas", "Última presença", "Telefone", "Responsável"],
    items.map((a) => [q(a.class_name), q(a.name), a.faltas, q(a.lastPresent ? a.lastPresent.split("-").reverse().join("/") : "—"), q(a.phone ?? ""), q(a.guardian_name ?? "")]),
  );
}

/** Caixa da EBD no período. */
export function financeCsv(rows: { date: string; kind: string; category: string; description: string | null; class_name: string | null; amount_cents: number; manual: boolean }[]): string {
  return csv(
    ["Data", "Tipo", "Categoria", "Descrição", "Classe", "Valor (R$)", "Origem"],
    rows.map((r) => [q(r.date.split("-").reverse().join("/")), q(r.kind === "entrada" ? "Entrada" : "Saída"), q(r.category), q(r.description ?? ""),
      q(r.class_name ?? "Geral"), (r.kind === "saida" ? "-" : "") + money(r.amount_cents), q(r.manual ? "Lançamento" : "Automático")]),
  );
}

/** Pedido sugerido de revistas. */
export function orderCsv(rows: { name: string; matriculados: number; mediaPresentes: number | null; alunos: number; professores: number; priceCents: number | null; totalCents: number | null }[]): string {
  return csv(
    ["Classe", "Matriculados", "Média de presentes", "Revistas de aluno", "Revistas de professor", "Preço unitário (R$)", "Total (R$)"],
    rows.map((r) => [q(r.name), r.matriculados, num(r.mediaPresentes), r.alunos, r.professores, r.priceCents === null ? "" : money(r.priceCents), r.totalCents === null ? "" : money(r.totalCents)]),
  );
}

/** Visitantes e situação no funil. */
export function visitorsCsv(rows: { name: string; phone: string | null; class_name: string | null; status: string; visits: number; first_visit: string | null; last_visit: string | null; how_found: string | null; invited_by: string | null }[]): string {
  const d = (s: string | null) => (s ? s.split("-").reverse().join("/") : "");
  return csv(
    ["Nome", "Telefone", "Classe", "Situação", "Visitas", "1ª visita", "Última visita", "Como conheceu", "Convidado por"],
    rows.map((r) => [q(r.name), q(r.phone ?? ""), q(r.class_name ?? ""), q(r.status), r.visits, q(d(r.first_visit)), q(d(r.last_visit)), q(r.how_found ?? ""), q(r.invited_by ?? "")]),
  );
}
