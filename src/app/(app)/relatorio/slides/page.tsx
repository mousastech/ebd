import { canSeeSomething } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { congregationName, getSettings } from "@/lib/church";
import { financeSummary, listFinance } from "@/lib/finance";
import { brl, parseQuarter, quarterKey, quarterLabel, quarterRange, todayISO } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { classThermometer, teacherRanking } from "@/lib/insights";
import { frequency, getBI } from "@/lib/repo";
import { visitorFunnel } from "@/lib/visitors";
import { Columns, HBars } from "@/components/charts";
import { SlideDeck } from "@/components/SlideDeck";

/** Relatório do trimestre em slides, para apresentar na reunião da EBD ou ao Pastor. */
export default async function SlidesPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const user = await requireUser();
  const q = parseQuarter((await searchParams).t);
  const bi = guarded(() => getBI(user, q));
  const s = getSettings();
  const cong = user.view != null ? congregationName(user.view) : null;
  const thermo = classThermometer(user, todayISO()).filter((c) => c.trend !== "sem-dados");
  const teachers = teacherRanking(user, q).slice(0, 6);
  const { from, to } = quarterRange(q);
  const funnel = canSeeSomething(user, "visitor") ? visitorFunnel(user, from, to) : null;
  const fin = canSeeSomething(user, "finance") ? financeSummary(listFinance(user, from, to)) : null;
  const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
  const t = bi.current.total;
  const tp = t.professoresRegistros ? (t.professoresPresentes / t.professoresRegistros) * 100 : null;

  return (
    <SlideDeck backHref={`/relatorio?t=${quarterKey(q)}`}>
      <section className="s-cover">
        {s.logo && <img src={`/arquivos/${s.logo}`} alt="" className="s-logo" />}
        <div className="s-kicker">{s.church_name}{cong ? ` · ${cong}` : ""}</div>
        <h1>Relatório da Escola Bíblica Dominical</h1>
        <div className="s-sub">{quarterLabel(q)}</div>
        <div className="s-foot">{s.lema}</div>
      </section>

      <section>
        <h2>O trimestre em números</h2>
        <div className="s-kpis">
          <div><strong>{pct(frequency(t))}</strong><span>frequência dos alunos</span></div>
          <div><strong>{bi.mediaPorAula ?? "—"}</strong><span>alunos por aula (média)</span></div>
          <div><strong>{t.visitantes}</strong><span>visitantes</span></div>
          <div><strong>{brl(t.ofertaCents)}</strong><span>ofertas</span></div>
          <div><strong>{pct(tp)}</strong><span>presença dos professores</span></div>
          <div><strong>{bi.people.matriculados}</strong><span>alunos matriculados</span></div>
        </div>
        <p className="s-note">Considera apenas as aulas validadas pela secretaria geral ({t.aulasValidadas} de {t.aulasProgramadas}).</p>
      </section>

      <section>
        <h2>Frequência nos últimos trimestres</h2>
        <div className="s-chart"><Columns height={260} points={bi.trend.map((x) => ({ label: `${x.quarter.q}º/${String(x.quarter.year).slice(2)}`, value: x.frequencia }))} format={pct} /></div>
      </section>

      <section>
        <h2>Por Escala</h2>
        <table className="s-table">
          <thead><tr><th>Escala</th><th>Coordenação</th><th>Classes</th><th>Frequência</th><th>Visitantes</th><th>Ofertas</th></tr></thead>
          <tbody>
            {bi.groups.map((g) => (
              <tr key={String(g.id)}><td>{g.name}</td><td>{g.coordinator ?? "—"}</td><td>{g.classes}</td><td>{pct(frequency(g.total))}</td><td>{g.total.visitantes}</td><td>{brl(g.total.ofertaCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Frequência por classe</h2>
        <div className="s-chart">
          <HBars max={100} format={pct} rows={[...bi.current.classes].map((c) => ({ label: c.cls.name, value: frequency(c.total) })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).map((r) => ({ ...r, tone: r.value === null ? "brand" : r.value >= 75 ? "ok" : r.value >= 50 ? "warn" : "bad" }))} />
        </div>
      </section>

      {thermo.length > 0 && (
        <section>
          <h2>Termômetro das classes</h2>
          <div className="s-cols">
            <div><h3>▲ Crescendo</h3>{thermo.filter((c) => c.trend === "crescendo").map((c) => <p key={c.id}>{c.name} <b>+{c.delta}</b></p>)}</div>
            <div><h3>■ Estáveis</h3>{thermo.filter((c) => c.trend === "estavel").map((c) => <p key={c.id}>{c.name}</p>)}</div>
            <div><h3>▼ Atenção</h3>{thermo.filter((c) => c.trend === "caindo").map((c) => <p key={c.id}>{c.name} <b>{c.delta}</b></p>)}</div>
          </div>
        </section>
      )}

      {teachers.length > 0 && (
        <section>
          <h2>Professores em destaque</h2>
          <ol className="s-rank">
            {teachers.map((p) => <li key={p.id}><span>{p.name}</span><small>{p.presente}/{p.escaladas} aulas · turma {p.mediaTurma ?? "—"}%</small></li>)}
          </ol>
        </section>
      )}

      {funnel && funnel.total > 0 && (
        <section>
          <h2>Visitantes</h2>
          <div className="s-kpis">
            <div><strong>{funnel.total}</strong><span>visitaram</span></div>
            <div><strong>{funnel.retornaram}</strong><span>voltaram ({pct(funnel.pctRetorno)})</span></div>
            <div><strong>{funnel.matriculados}</strong><span>matriculados ({pct(funnel.pctMatricula)})</span></div>
          </div>
        </section>
      )}

      {fin && (
        <section>
          <h2>Caixa da EBD</h2>
          <div className="s-kpis">
            <div><strong>{brl(fin.entradas)}</strong><span>entradas</span></div>
            <div><strong>{brl(fin.saidas)}</strong><span>saídas</span></div>
            <div><strong>{brl(fin.saldo)}</strong><span>saldo</span></div>
          </div>
        </section>
      )}

      <section className="s-cover">
        <h1>“Lâmpada para os meus pés é tua palavra e luz, para o meu caminho.”</h1>
        <div className="s-sub">Salmos 119.105</div>
        <div className="s-foot">{s.lema}</div>
      </section>
    </SlideDeck>
  );
}
