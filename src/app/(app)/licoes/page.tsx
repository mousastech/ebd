import Link from "next/link";
import { saveCurriculumAction, savePlanAction } from "@/app/actions-ensino";
import { canSeeSomething, ForbiddenError } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDay, parseQuarter, quarterKey, quarterLabel, shiftQuarter, todayISO } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { curriculumClasses, getCurriculum, listPlans } from "@/lib/teaching";
import { Empty, FlashMessage } from "@/components/ui";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function LessonsPage({ searchParams }: { searchParams: Promise<Flash & { t?: string; classe?: string; aba?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.aba === "planos" ? "planos" : "licoes";
  const canPlans = canSeeSomething(user, "plan");
  guarded(() => { if (!canSeeSomething(user, "curriculum") && !canPlans) throw new ForbiddenError(); });
  const q = parseQuarter(sp.t);
  const key = quarterKey(q);
  const classes = curriculumClasses(user);
  const cls = classes.find((c) => c.id === Number(sp.classe)) ?? classes[0];
  const lessons = cls ? getCurriculum(user, cls.id, q) : [];
  const today = todayISO();
  const plans = tab === "planos" && canPlans ? listPlans(user, addDays(today, -14), addDays(today, 35)) : [];
  const dates = [...new Set(plans.map((p) => p.date))];

  return (
    <>
      <div className="pagehead"><div><h1>Lições e planos de aula</h1><p className="muted small">{quarterLabel(q)}</p></div></div>
      <FlashMessage flash={sp} />
      <nav className="chips">
        <Link href={`/licoes?t=${key}`} className={tab === "licoes" ? "active" : ""}>Lições do trimestre</Link>
        {canPlans && <Link href="/licoes?aba=planos" className={tab === "planos" ? "active" : ""}>Planos de aula</Link>}
      </nav>

      {tab === "licoes" && (
        <>
          <div className="row" style={{ marginBottom: ".6rem" }}>
            <Link className="btn ghost small" href={`/licoes?t=${quarterKey(shiftQuarter(q, -1))}${cls ? `&classe=${cls.id}` : ""}`}>← Trimestre anterior</Link>
            <Link className="btn ghost small" href={`/licoes?t=${quarterKey(shiftQuarter(q, 1))}${cls ? `&classe=${cls.id}` : ""}`}>Próximo →</Link>
          </div>
          {classes.length === 0 ? <Empty>Nenhuma classe disponível.</Empty> : (
            <nav className="chips" aria-label="Classes">
              {classes.map((c) => <Link key={c.id} href={`/licoes?t=${key}&classe=${c.id}`} className={c.id === cls?.id ? "active" : ""}>{c.name}</Link>)}
            </nav>
          )}
          {cls && (
            <>
              {lessons.length === 0 ? <Empty>As lições deste trimestre ainda não foram cadastradas.</Empty> : (
                <div className="card">
                  <div className="lessons">
                    {lessons.map((l) => (
                      <div key={l.id} className="lesson-row" style={{ cursor: "default" }}>
                        <span className="num">{l.number}</span>
                        <span className="grow">
                          <strong>{l.title}</strong>
                          <small className="muted">
                            {l.date ? `${fmtDate(l.date)} · ${l.teacher ?? "sem professor"}` : "sem domingo (escala não gerada)"}
                            {l.reading ? ` · Leitura: ${l.reading}` : ""}
                          </small>
                          {l.golden_text && <small><em>Texto áureo:</em> {l.golden_text}</small>}
                        </span>
                        {l.date && <span className={`chip ${l.plan ? "ok" : ""}`}><i />{l.plan ? "Plano" : "Sem plano"}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {cls.canEdit && (
                <details className="card" open={lessons.length === 0}>
                  <summary><strong>{lessons.length ? "Editar lições" : "Cadastrar lições"} — {cls.name}</strong></summary>
                  <form action={saveCurriculumAction} className="stack" style={{ marginTop: ".6rem" }}>
                    <input type="hidden" name="class_id" value={cls.id} />
                    <input type="hidden" name="quarter" value={key} />
                    <p className="small muted" style={{ margin: 0 }}>
                      Cole o sumário da revista, uma lição por linha. Opcional: leitura e texto áureo separados por “|”.<br />
                      Ex.: <code>1. A Criação | Gn 1.1-31 | No princípio criou Deus os céus e a terra.</code>
                    </p>
                    <textarea name="text" rows={10} defaultValue={lessons.map((l) => [`${l.number}. ${l.title}`, l.reading, l.golden_text].filter((x, i) => i === 0 || x).join(" | ")).join("\n")} />
                    <button type="submit">Salvar lições</button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}

      {tab === "planos" && (
        <>
          <p className="muted small">Aulas das últimas 2 semanas e das próximas 5. O professor escalado escreve o plano; a coordenação acompanha.</p>
          {plans.length === 0 ? <Empty>Nenhuma aula no período.</Empty> : dates.map((d) => (
            <section key={d}>
              <h3 className="section-label">{fmtDay(d)} · {plans.filter((p) => p.date === d && p.plan).length}/{plans.filter((p) => p.date === d).length} planos</h3>
              <div className="list">
                {plans.filter((p) => p.date === d).map((p) => (
                  <div key={p.id} className="list-card">
                    <div className="row between" style={{ flexWrap: "nowrap" }}>
                      <strong>{p.class_name}</strong>
                      <span className={`chip ${p.plan ? "ok" : d < today ? "bad" : ""}`}><i />{p.plan ? "Plano entregue" : "Sem plano"}</span>
                    </div>
                    <div className="small muted">{p.teacher ?? "Sem professor"}{p.topic ? ` · ${p.topic}` : ""}</div>
                    {p.reading && <div className="small">Leitura: {p.reading}</div>}
                    {p.canEdit ? (
                      <details open={!p.plan && d >= today}>
                        <summary className="small">{p.plan ? "Ver/editar plano" : "Escrever plano"}</summary>
                        <form action={savePlanAction} className="stack" style={{ marginTop: ".4rem" }}>
                          <input type="hidden" name="lesson_id" value={p.id} />
                          <textarea name="plan" rows={6} defaultValue={p.plan ?? ""} placeholder={"Objetivo da aula:\nIntrodução (5 min):\nDesenvolvimento:\nAplicação prática:\nRecursos:"} />
                          <button type="submit" className="small">Salvar plano</button>
                        </form>
                      </details>
                    ) : p.plan ? (
                      <details><summary className="small">Ver plano</summary><p className="small announce-body">{p.plan}</p></details>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
