import { Letterhead } from "@/components/Letterhead";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { brl, monthName, parseQuarter, quarterKey, quarterLabel, shiftQuarter } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { frequency, getConsolidated, getPersonFrequency, listGroups, type Tally } from "@/lib/repo";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";

const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR")}%`);
const teachersPct = (t: Tally) =>
  t.professoresRegistros ? `${((t.professoresPresentes / t.professoresRegistros) * 100).toFixed(1).replace(".", ",")}%` : "—";

function Cells({ t }: { t: Tally }) {
  return (
    <>
      <td>{t.aulasValidadas}/{t.aulasProgramadas}</td>
      <td>{pct(frequency(t))}</td>
      <td>{teachersPct(t)}</td>
      <td>{t.visitantes}</td>
      <td className="nowrap">{brl(t.ofertaCents)}</td>
      <td>{t.pendencias > 0 ? <span className="badge warn">{t.pendencias}</span> : <span className="muted">0</span>}</td>
    </>
  );
}

const HEAD = (
  <tr>
    <th>Aulas validadas / programadas</th><th>Frequência alunos</th><th>Professores</th><th>Visitantes</th><th>Oferta</th><th>Pendências</th>
  </tr>
);

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ t?: string; classe?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const quarter = parseQuarter(sp.t);
  const key = quarterKey(quarter);
  const report = guarded(() => getConsolidated(user, quarter));
  const groups = listGroups(user);
  const groupOf = (id: number | null) => groups.find((g) => g.id === id);
  const detailId = Number(sp.classe) || null;
  const detail = detailId && report.classes.some((c) => c.cls.id === detailId)
    ? { cls: report.classes.find((c) => c.cls.id === detailId)!.cls, freq: guarded(() => getPersonFrequency(user, detailId, quarter)) }
    : null;

  return (
    <>
      <Letterhead printOnly title="Relatório consolidado" subtitle={quarterLabel(quarter)} congregationId={user.view} />
      <div className="row between">
        <h1>Relatório consolidado — {quarterLabel(quarter)}</h1>
        <div className="row noprint">
          <Link className="btn ghost small" href={`/relatorio?t=${quarterKey(shiftQuarter(quarter, -1))}`}>← Anterior</Link>
          <Link className="btn ghost small" href="/relatorio">Atual</Link>
          <Link className="btn ghost small" href={`/relatorio?t=${quarterKey(shiftQuarter(quarter, 1))}`}>Próximo →</Link>
          <Link className="btn small" href={`/relatorio/slides?t=${key}`}>▶ Apresentação</Link>
          <a className="btn ghost small" href={`/relatorio/exportar?t=${key}`}>Baixar CSV</a>
          <PrintButton />
        </div>
      </div>

      {report.total.pendencias > 0 && (
        <div className="note">
          Há <strong>{report.total.pendencias}</strong> aula(s) ainda sem relatório validado. Os números abaixo contam
          apenas as aulas <strong>validadas</strong> pela secretaria geral.
        </div>
      )}

      <div className="grid">
        <div className="card"><div className="muted small">Frequência dos alunos</div><div className="stat">{pct(frequency(report.total))}</div></div>
        <div className="card"><div className="muted small">Visitantes</div><div className="stat">{report.total.visitantes}</div></div>
        <div className="card"><div className="muted small">Ofertas</div><div className="stat">{brl(report.total.ofertaCents)}</div></div>
        <div className="card"><div className="muted small">Aulas validadas</div><div className="stat">{report.total.aulasValidadas}/{report.total.aulasProgramadas}</div></div>
      </div>

      <h2>Por mês</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Mês</th>{HEAD.props.children}</tr></thead>
          <tbody>
            {report.months.map((m) => (
              <tr key={m.month}><td style={{ textTransform: "capitalize" }}>{monthName(m.month)}</td><Cells t={m.tally} /></tr>
            ))}
            <tr><td><strong>Trimestre</strong></td><Cells t={report.total} /></tr>
          </tbody>
        </table>
      </div>

      <h2>Por classe</h2>
      {report.classes.length === 0 && <Empty>Sem classes para exibir.</Empty>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Classe</th><th>Matriculados</th>{HEAD.props.children}</tr></thead>
          <tbody>
            {report.classes.map((c, i) => {
              const g = groupOf(c.cls.group_id);
              const first = i === 0 || report.classes[i - 1].cls.group_id !== c.cls.group_id;
              return [
                first && (
                  <tr key={`g${c.cls.group_id}`}>
                    <td colSpan={8} className="muted small" style={{ background: "var(--brand-soft)" }}>
                      <strong>{g?.name ?? "Sem escala"}</strong>{g?.coordinator ? ` — coordenador(a): ${g.coordinator}` : ""}
                    </td>
                  </tr>
                ),
                <tr key={c.cls.id}>
                  <td><Link href={`/relatorio?t=${key}&classe=${c.cls.id}`}>{c.cls.name}</Link></td>
                  <td>{c.matriculados}</td>
                  <Cells t={c.total} />
                </tr>,
              ];
            })}
            <tr><td><strong>Total EBD</strong></td><td><strong>{report.classes.reduce((n, c) => n + c.matriculados, 0)}</strong></td><Cells t={report.total} /></tr>
          </tbody>
        </table>
      </div>

      {detail && (
        <>
          <h2>Frequência individual — {detail.cls.name}</h2>
          <div className="grid">
            <div className="card table-wrap">
              <h3>Alunos</h3>
              <table>
                <thead><tr><th>Nome</th><th>Presenças</th><th>%</th></tr></thead>
                <tbody>
                  {detail.freq.alunos.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{p.presentes}/{p.total}</td><td>{pct(p.pct)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card table-wrap">
              <h3>Professores (aulas escaladas)</h3>
              <table>
                <thead><tr><th>Nome</th><th>Presenças</th><th>%</th></tr></thead>
                <tbody>
                  {detail.freq.professores.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{p.presentes}/{p.total}</td><td>{pct(p.pct)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
