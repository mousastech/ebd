import { createMaterialAction, registerPaymentAction } from "@/app/actions";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { brl, fmtDate, todayISO } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { listClasses, listOrders } from "@/lib/repo";
import { Empty, FlashMessage } from "@/components/ui";
import { magazineSuggestion } from "@/lib/insights";
import { parseQuarter, quarterLabel, shiftQuarter } from "@/lib/format";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const orders = guarded(() => listOrders(user));
  const today = todayISO();
  const classes = listClasses(user).filter((c) => can(user, "create", { type: "material_order", classIds: [c.id] }));
  const canCreateMaterial = can(user, "create", { type: "material" }) && classes.length > 0;

  const total = orders.reduce((a, o) => a + o.price_cents, 0);
  const paid = orders.reduce((a, o) => a + o.paid_cents, 0);
  const byClass = new Map<string, typeof orders>();
  for (const o of orders) byClass.set(o.class_name ?? "Sem classe", [...(byClass.get(o.class_name ?? "Sem classe") ?? []), o]);
  const showSummary = user.role !== "aluno";
  // pedido sugerido para o PRÓXIMO trimestre, com base na presença do trimestre atual (ou do anterior, se ainda vazio)
  const cur = parseQuarter(undefined);
  const next = shiftQuarter(cur, 1);
  let base = cur;
  let suggestion = showSummary ? magazineSuggestion(user, base) : [];
  if (suggestion.length && suggestion.every((s) => s.mediaPresentes === null)) {
    base = shiftQuarter(cur, -1);
    suggestion = magazineSuggestion(user, base);
  }
  const sugTotal = suggestion.reduce((n, s) => n + (s.totalCents ?? 0), 0);

  return (
    <>
      <h1>Material didático</h1>
      <FlashMessage flash={flash} />

      {showSummary && orders.length > 0 && (
        <div className="grid">
          <div className="card"><div className="muted small">Total em revistas</div><div className="stat">{brl(total)}</div></div>
          <div className="card"><div className="muted small">Recebido</div><div className="stat">{brl(paid)}</div></div>
          <div className="card"><div className="muted small">A receber</div><div className="stat">{brl(total - paid)}</div></div>
        </div>
      )}

      {suggestion.length > 0 && (
        <details className="card table-wrap">
          <summary><strong>Pedido sugerido — {quarterLabel(next)}</strong> <span className="muted small">pela média de presença do {quarterLabel(base)}</span></summary>
          <p className="muted small" style={{ marginTop: ".5rem" }}>
            Revistas de aluno = média de presentes por aula + 10% de folga (visitantes e novos), nunca menos que metade dos
            matriculados; mais uma revista por professor. Ajuste antes de fazer o pedido à editora.
          </p>
          <table>
            <thead><tr><th>Classe</th><th>Matriculados</th><th>Média presentes</th><th>Aluno</th><th>Professor</th><th>Total</th></tr></thead>
            <tbody>
              {suggestion.map((s) => (
                <tr key={s.classId}>
                  <td>{s.name}</td><td>{s.matriculados}</td><td>{s.mediaPresentes?.toLocaleString("pt-BR") ?? "—"}</td>
                  <td><strong>{s.alunos}</strong></td><td>{s.professores}</td>
                  <td className="nowrap">{s.totalCents !== null ? brl(s.totalCents) : "—"}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td><td>{suggestion.reduce((n, s) => n + s.matriculados, 0)}</td><td />
                <td><strong>{suggestion.reduce((n, s) => n + s.alunos, 0)}</strong></td>
                <td><strong>{suggestion.reduce((n, s) => n + s.professores, 0)}</strong></td>
                <td className="nowrap"><strong>{brl(sugTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
          <p className="small"><a href={`/relatorio/exportar?tipo=pedido`}>Baixar pedido (CSV)</a></p>
        </details>
      )}

      {orders.length === 0 && <Empty>Nenhuma revista encontrada.</Empty>}

      {[...byClass.entries()].map(([cls, items]) => (
        <div className="card table-wrap" key={cls}>
          <h3>{cls} — {items[0].material_title}</h3>
          <table>
            <thead>
              <tr><th>Aluno</th><th>Valor</th><th>Pago</th><th>Situação</th><th>Registrar pagamento</th></tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.person_name}
                    {o.payments.length > 0 && (
                      <div className="muted small">
                        {o.payments.map((p) => `${fmtDate(p.paid_at)} ${brl(p.amount_cents)} (${p.method})`).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">{brl(o.price_cents)}</td>
                  <td className="nowrap">{brl(o.paid_cents)}</td>
                  <td>
                    {o.balance_cents === 0 ? <span className="badge ok">Quitada</span>
                      : o.paid_cents > 0 ? <span className="badge warn">Falta {brl(o.balance_cents)}</span>
                      : <span className="badge bad">Em aberto</span>}
                  </td>
                  <td>
                    {o.canPay && o.balance_cents > 0 && (
                      <form action={registerPaymentAction} className="row" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="order_id" value={o.id} />
                        <input name="amount" inputMode="decimal" aria-label="Valor" defaultValue={(o.balance_cents / 100).toFixed(2).replace(".", ",")} style={{ width: "6rem" }} />
                        <select name="method" aria-label="Forma" style={{ width: "7.5rem" }}>
                          <option value="dinheiro">Dinheiro</option>
                          <option value="pix">Pix</option>
                          <option value="cartão">Cartão</option>
                          <option value="transferência">Transferência</option>
                        </select>
                        <input type="hidden" name="date" value={today} />
                        <button className="small" type="submit">Receber</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {canCreateMaterial && (
        <form action={createMaterialAction} className="card">
          <h2 style={{ marginTop: 0 }}>Nova revista</h2>
          <p className="muted small">Gera automaticamente um pedido para cada aluno matriculado na classe.</p>
          <div className="form-grid">
            <div><label htmlFor="mt">Título</label><input id="mt" name="title" required /></div>
            <div><label htmlFor="mp">Período</label><input id="mp" name="period" placeholder="1º trimestre 2027" /></div>
            <div><label htmlFor="mv">Preço (R$)</label><input id="mv" name="price" inputMode="decimal" required placeholder="18,90" /></div>
            <div>
              <label htmlFor="mc">Classe</label>
              <select id="mc" name="class_id" required>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button type="submit">Cadastrar</button>
          </div>
        </form>
      )}
    </>
  );
}
