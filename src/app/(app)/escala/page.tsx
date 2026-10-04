import Link from "next/link";
import { generateScheduleAction, saveScheduleAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { monthName, parseQuarter, quarterKey, quarterLabel, shiftQuarter } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { EVENT_OPTIONS } from "@/lib/labels";
import { getQuarterSchedule, scheduleValue, type QuarterClass } from "@/lib/repo";
import { Empty, FlashMessage } from "@/components/ui";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Flash & { t?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const quarter = parseQuarter(sp.t);
  const key = quarterKey(quarter);
  const classes = guarded(() => getQuarterSchedule(user, quarter));

  // agrupa por Escala (cada Escala tem um coordenador e sai numa folha)
  const groups = new Map<string, { id: number | null; name: string; coordinator: string | null; classes: QuarterClass[] }>();
  for (const c of classes) {
    const k = String(c.group?.id ?? "none");
    if (!groups.has(k))
      groups.set(k, { id: c.group?.id ?? null, name: c.group?.name ?? "Sem escala", coordinator: c.group?.coordinator ?? null, classes: [] });
    groups.get(k)!.classes.push(c);
  }

  return (
    <>
      <div className="row between">
        <h1>Escala — {quarterLabel(quarter)}</h1>
        <div className="row">
          <Link className="btn ghost small" href={`/escala?t=${quarterKey(shiftQuarter(quarter, -1))}`}>← Anterior</Link>
          <Link className="btn ghost small" href="/escala">Hoje</Link>
          <Link className="btn ghost small" href={`/escala?t=${quarterKey(shiftQuarter(quarter, 1))}`}>Próximo →</Link>
        </div>
      </div>
      <p className="muted">Cada trimestre tem todos os domingos de três meses. Em cada domingo escolha o professor do rodízio ou um domingo sem aula.</p>
      <FlashMessage flash={sp} />
      {classes.length === 0 && <Empty>Nenhuma classe disponível para você.</Empty>}

      {[...groups.values()].map((g) => (
        <section key={g.name}>
          <div className="row between" style={{ marginTop: "1.5rem" }}>
            <h2 style={{ margin: 0 }}>
              {g.name}
              {g.coordinator && <span className="muted" style={{ fontWeight: 400, fontSize: "1rem" }}> — coordenador(a): {g.coordinator}</span>}
            </h2>
            {g.id !== null && (
              <Link className="btn ghost small" href={`/escala/imprimir?t=${key}&g=${g.id}`}>Folha para impressão</Link>
            )}
          </div>

          {g.classes.map((c) => {
            const total = c.months.reduce((n, m) => n + m.rows.length, 0);
            const generated = c.months.reduce((n, m) => n + m.rows.filter((r) => r.lesson).length, 0);
            const editable = c.canEdit && generated > 0;
            const body = (
              <>
                <div className="quarter">
                  {c.months.map((m) => (
                    <div className="qmonth" key={m.month}>
                      <h4>{monthName(m.month)}</h4>
                      <table>
                        <tbody>
                          {m.rows.map(({ date, lesson }) => {
                            const day = Number(date.slice(8));
                            if (!lesson) return <tr key={date}><td className="day">{day}</td><td className="muted">— não gerado —</td></tr>;
                            const locked = lesson.report_status === "enviada" || lesson.report_status === "validada";
                            const value = scheduleValue(lesson);
                            const customEvent = value.startsWith("e:") && !(EVENT_OPTIONS as readonly string[]).includes(value.slice(2));
                            return (
                              <tr key={date}>
                                <td className="day">{day}</td>
                                <td>
                                  {editable && !locked ? (
                                    <select name={`l_${lesson.id}`} defaultValue={value} aria-label={`Domingo ${day}`}>
                                      <option value="">— sem professor —</option>
                                      {c.professors.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
                                      <optgroup label="Sem aula">
                                        {EVENT_OPTIONS.map((e) => <option key={e} value={`e:${e}`}>{e}</option>)}
                                        {customEvent && <option value={value}>{value.slice(2)}</option>}
                                      </optgroup>
                                    </select>
                                  ) : lesson.kind === "evento" ? (
                                    <span className="ev">{lesson.event_label}</span>
                                  ) : (
                                    <>
                                      {lesson.teacher_name ?? <span className="muted">—</span>}
                                      {locked && <span className="badge ok" style={{ marginLeft: ".4rem" }} title="Relatório enviado ou validado">🔒</span>}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </>
            );
            return (
              <div className="card" key={c.cls.id}>
                <div className="row between" style={{ marginBottom: ".5rem" }}>
                  <h3 style={{ margin: 0 }}>
                    Classe {c.cls.name} {c.cls.age_range && <span className="muted" style={{ fontWeight: 400 }}>· {c.cls.age_range}</span>}
                  </h3>
                  <span className="muted small">
                    Secretário(a): {c.secretary ?? <span className="badge warn">não designado</span>} · {c.professors.length} professor(es) no rodízio
                  </span>
                </div>

                {editable ? (
                  <form action={saveScheduleAction}>
                    <input type="hidden" name="class_id" value={c.cls.id} />
                    <input type="hidden" name="quarter" value={key} />
                    {body}
                    <div className="row" style={{ marginTop: ".75rem" }}>
                      <button type="submit">Salvar escala de {c.cls.name}</button>
                    </div>
                  </form>
                ) : (
                  body
                )}

                {c.canGenerate && generated < total && (
                  <form action={generateScheduleAction} className="row" style={{ marginTop: ".75rem", paddingTop: ".75rem", borderTop: "1px solid var(--line)" }}>
                    <input type="hidden" name="class_id" value={c.cls.id} />
                    <input type="hidden" name="quarter" value={key} />
                    <label style={{ margin: 0 }} htmlFor={`modo-${c.cls.id}`}>
                      {generated === 0 ? "Gerar os domingos do trimestre:" : "Completar os domingos que faltam:"}
                    </label>
                    <select id={`modo-${c.cls.id}`} name="modo" defaultValue="rodizio" style={{ width: "auto" }}>
                      <option value="rodizio">com rodízio dos professores</option>
                      <option value="vazia">sem professor (preencho depois)</option>
                      <option value="remanejada">classe remanejada no trimestre</option>
                    </select>
                    <button className="ghost small" type="submit">Gerar</button>
                  </form>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
