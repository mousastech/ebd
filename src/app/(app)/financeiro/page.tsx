import Link from "next/link";
import { createFinanceAction, deleteFinanceAction } from "@/app/actions-gestao";
import { can, canSeeSomething, ForbiddenError } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { brl, fmtDate, monthName, parseQuarter, quarterKey, quarterLabel, quarterRange, shiftQuarter, todayISO } from "@/lib/format";
import { financeSummary, IN_CATEGORIES, listFinance, OUT_CATEGORIES } from "@/lib/finance";
import { guarded, type Flash } from "@/lib/guard";
import { listClasses } from "@/lib/repo";
import { HBars } from "@/components/charts";
import { Hero } from "@/components/app-ui";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { Empty, FlashMessage } from "@/components/ui";

/** Caixa da EBD: entradas automáticas (ofertas validadas, revistas) e lançamentos manuais. */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Flash & { t?: string; ano?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  guarded(() => { if (!canSeeSomething(user, "finance")) throw new ForbiddenError(); });
  const year = Number(sp.ano) || null;
  const quarter = parseQuarter(sp.t);
  const { from, to } = year ? { from: `${year}-01-01`, to: `${year}-12-31` } : quarterRange(quarter);
  const rows = listFinance(user, from, to);
  const sum = financeSummary(rows);
  // na lista, as entradas automáticas aparecem somadas por dia (uma linha por domingo), os lançamentos um a um
  const auto = new Map<string, { id: string; date: string; category: string; amount_cents: number; n: number }>();
  for (const r of rows.filter((x) => !x.manual)) {
    const k = `${r.date}|${r.category}`;
    const cur = auto.get(k) ?? { id: k, date: r.date, category: r.category, amount_cents: 0, n: 0 };
    cur.amount_cents += r.amount_cents;
    cur.n++;
    auto.set(k, cur);
  }
  const listRows = [
    ...rows.filter((r) => r.manual),
    ...[...auto.values()].map((a) => ({
      id: a.id, manual: false, kind: "entrada" as const, category: a.category,
      description: a.n > 1 ? `${a.n} lançamentos somados` : null, amount_cents: a.amount_cents, date: a.date,
      class_id: null, class_name: "Várias", congregation_id: 0, canDelete: false,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const key = quarterKey(quarter);
  const period = year ? `Ano de ${year}` : quarterLabel(quarter);
  const classes = listClasses(user).filter((c) => can(user, "create", { type: "finance", classIds: [c.id], congregationId: c.congregation_id }));
  const canCreateGeneral = can(user, "create", { type: "finance", congregationId: user.view ?? user.home });

  return (
    <>
      <Letterhead printOnly title="Caixa da EBD" subtitle={period} congregationId={user.view} />
      <div className="row between">
        <div className="pagehead"><div><h1>Financeiro</h1><p className="muted small">{period}</p></div></div>
        <div className="row noprint">
          <Link className="btn ghost small" href={`/financeiro?t=${quarterKey(shiftQuarter(quarter, -1))}`}>←</Link>
          <Link className="btn ghost small" href="/financeiro">Trimestre atual</Link>
          <Link className="btn ghost small" href={`/financeiro?ano=${(year ?? quarter.year)}`}>Ano</Link>
          <Link className="btn ghost small" href={`/financeiro?t=${quarterKey(shiftQuarter(quarter, 1))}`}>→</Link>
          <a className="btn ghost small" href={`/relatorio/exportar?tipo=financeiro&de=${from}&ate=${to}`}>CSV</a>
          <PrintButton />
        </div>
      </div>
      <FlashMessage flash={sp} />

      <Hero
        eyebrow="Saldo do período"
        value={brl(sum.saldo)}
        stats={[
          { label: "Entradas", value: brl(sum.entradas) },
          { label: "Saídas", value: brl(sum.saidas) },
          { label: "Lançamentos", value: rows.length },
        ]}
      />

      {(classes.length > 0 || canCreateGeneral) && (
        <details className="card noprint">
          <summary><strong>＋ Novo lançamento</strong></summary>
          <form action={createFinanceAction} className="form-grid" style={{ marginTop: ".7rem" }}>
            <input type="hidden" name="t" value={key} />
            <div>
              <label htmlFor="fk">Tipo</label>
              <select id="fk" name="kind"><option value="saida">Saída (despesa)</option><option value="entrada">Entrada</option></select>
            </div>
            <div>
              <label htmlFor="fc">Categoria</label>
              <input id="fc" name="category" list="cats" required placeholder="ex.: Compra de revistas" />
              <datalist id="cats">{[...OUT_CATEGORIES, ...IN_CATEGORIES].map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div><label htmlFor="fa">Valor (R$)</label><input id="fa" name="amount" inputMode="decimal" required placeholder="0,00" /></div>
            <div><label htmlFor="fd">Data</label><input id="fd" name="date" type="date" defaultValue={todayISO()} required /></div>
            <div>
              <label htmlFor="fcl">Classe (opcional)</label>
              <select id="fcl" name="class_id">
                {canCreateGeneral && <option value="">Geral da EBD</option>}
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label htmlFor="fm">Forma</label><select id="fm" name="method"><option>pix</option><option>dinheiro</option><option>cartão</option><option>transferência</option></select></div>
            <div><label htmlFor="fds">Descrição</label><input id="fds" name="description" /></div>
            <button type="submit">Lançar</button>
          </form>
        </details>
      )}

      <div className="bi-grid">
        <div className="card table-wrap">
          <h3>Por mês</h3>
          {sum.byMonth.length === 0 ? <Empty>Sem movimento.</Empty> : (
            <table>
              <thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Saldo</th></tr></thead>
              <tbody>
                {sum.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td style={{ textTransform: "capitalize" }}>{monthName(Number(m.month.slice(5)))}</td>
                    <td className="nowrap">{brl(m.entradas)}</td><td className="nowrap">{brl(m.saidas)}</td>
                    <td className="nowrap"><strong>{brl(m.entradas - m.saidas)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Por categoria</h3>
          {sum.byCategory.length === 0 ? <Empty>Sem movimento.</Empty> : (
            <HBars format={(v) => brl(v)} rows={sum.byCategory.map((c) => ({ label: c.category, value: c.total, tone: c.kind === "entrada" ? "ok" : "bad", sub: c.kind === "entrada" ? "entrada" : "saída" }))} />
          )}
        </div>
        <div className="card table-wrap">
          <h3>Por classe</h3>
          {sum.byClass.length === 0 ? <Empty>Sem lançamentos por classe.</Empty> : (
            <table>
              <thead><tr><th>Classe</th><th>Entradas</th><th>Custos</th></tr></thead>
              <tbody>{sum.byClass.map((c) => <tr key={c.name}><td>{c.name}</td><td className="nowrap">{brl(c.entradas)}</td><td className="nowrap">{brl(c.saidas)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      <h2>Lançamentos</h2>
      <div className="card table-wrap">
        {listRows.length === 0 ? <Empty>Nenhum lançamento no período.</Empty> : (
          <table>
            <thead><tr><th>Data</th><th>Categoria</th><th>Classe</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              {listRows.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.date)}</td>
                  <td>{r.category}{r.description && <div className="muted small">{r.description}</div>}{!r.manual && <div className="muted small">automático</div>}</td>
                  <td className="small">{r.class_name ?? "Geral"}</td>
                  <td className={`nowrap ${r.kind === "saida" ? "neg" : "pos"}`}>{r.kind === "saida" ? "− " : "+ "}{brl(r.amount_cents)}</td>
                  <td className="right">
                    {r.canDelete && (
                      <form action={deleteFinanceAction} className="noprint">
                        <input type="hidden" name="id" value={r.id.slice(1)} />
                        <button className="danger small" type="submit" aria-label="Excluir lançamento">Excluir</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
