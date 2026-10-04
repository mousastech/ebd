import { Letterhead } from "@/components/Letterhead";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/church";
import { parseQuarter, quarterKey, quarterLabel, shiftQuarter } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { getBlankRoster } from "@/lib/repo";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";

/**
 * Frequência manual: lista de chamada em branco por classe e trimestre, para imprimir e preencher no papel
 * (útil sem internet). Depois, o secretário da sala lança no sistema.
 */
export default async function BlankRosterPage({ searchParams }: { searchParams: Promise<{ t?: string; classe?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const quarter = parseQuarter(sp.t);
  const key = quarterKey(quarter);
  const all = guarded(() => getBlankRoster(user, quarter));
  const only = Number(sp.classe) || null;
  const sheets = only ? all.filter((s) => s.cls.id === only) : all;
  const extra = 4; // linhas em branco para alunos novos

  return (
    <>
      <div className="noprint">
        <h1>Frequência manual — {quarterLabel(quarter)}</h1>
        <p className="muted">Lista de chamada para imprimir. Marque P (presente) ou F (falta); depois o secretário da sala lança no sistema.</p>
        <div className="row" style={{ marginBottom: "1rem" }}>
          <Link className="btn ghost small" href={`/presenca/folha?t=${quarterKey(shiftQuarter(quarter, -1))}${only ? `&classe=${only}` : ""}`}>← Anterior</Link>
          <Link className="btn ghost small" href={`/presenca/folha?t=${quarterKey(shiftQuarter(quarter, 1))}${only ? `&classe=${only}` : ""}`}>Próximo →</Link>
          <form className="row" action="/presenca/folha">
            <input type="hidden" name="t" value={key} />
            <select name="classe" defaultValue={only ?? ""} aria-label="Classe">
              <option value="">Todas as classes</option>
              {all.map((s) => <option key={s.cls.id} value={s.cls.id}>{s.cls.name}</option>)}
            </select>
            <button className="ghost small" type="submit">Filtrar</button>
          </form>
          <a className="btn ghost small" href={`/relatorio/exportar?t=${key}&tipo=chamada${only ? `&classe=${only}` : ""}`}>Excel (CSV)</a>
          <PrintButton label="Imprimir / salvar em PDF" />
        </div>
      </div>

      {sheets.length === 0 ? <Empty>Nenhuma classe disponível para você.</Empty> : (
        <div className="paper roster">
          {sheets.map((s) => (
            <section key={s.cls.id} className="roster-page">
              <Letterhead title="Lista de chamada" subtitle={quarterLabel(quarter)} congregationId={s.cls.congregation_id} />
              <h2 className="ptitle">Classe {s.cls.name} — {quarterLabel(quarter)}</h2>
              <p className="small" style={{ margin: "0 0 .4rem", textAlign: "center" }}>
                {s.group?.name ?? ""}{s.group?.coordinator ? ` · Coord.: ${s.group.coordinator}` : ""} · Secretário(a): {s.secretary ?? "________________"}
              </p>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "1.6rem" }}>#</th>
                    <th style={{ textAlign: "left" }}>Aluno</th>
                    {s.dates.map((d) => (
                      <th key={d.date} className={d.lesson?.kind === "evento" ? "ev" : ""}>
                        {d.date.slice(8)}/{d.date.slice(5, 7)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.students.map((st, i) => (
                    <tr key={st.id}>
                      <td>{i + 1}</td>
                      <td className="name">{st.name}</td>
                      {s.dates.map((d) => <td key={d.date} className={d.lesson?.kind === "evento" ? "ev" : ""} />)}
                    </tr>
                  ))}
                  {Array.from({ length: extra }, (_, i) => (
                    <tr key={`x${i}`}>
                      <td>{s.students.length + i + 1}</td><td className="name" />
                      {s.dates.map((d) => <td key={d.date} className={d.lesson?.kind === "evento" ? "ev" : ""} />)}
                    </tr>
                  ))}
                  <tr className="sum"><td /><td className="name">Professor(a)</td>
                    {s.dates.map((d) => (
                      <td key={d.date} className="tiny">{d.lesson?.kind === "evento" ? d.lesson.event_label : d.lesson?.teacher ?? ""}</td>
                    ))}
                  </tr>
                  <tr className="sum"><td /><td className="name">Visitantes</td>{s.dates.map((d) => <td key={d.date} />)}</tr>
                  <tr className="sum"><td /><td className="name">Oferta (R$)</td>{s.dates.map((d) => <td key={d.date} />)}</tr>
                  <tr className="sum"><td /><td className="name">Revistas / Bíblias</td>{s.dates.map((d) => <td key={d.date} />)}</tr>
                </tbody>
              </table>
              <p className="lema">{getSettings().lema}</p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
