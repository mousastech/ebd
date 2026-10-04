import Link from "next/link";
import { addVisitAction, createVisitorAction, deleteVisitorAction, enrollVisitorAction, setVisitorStatusAction } from "@/app/actions-gestao";
import { can, canSeeSomething, ForbiddenError } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { fmtDate, todayISO } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { listClasses } from "@/lib/repo";
import { HOW_FOUND, listVisitors, VISITOR_LABEL, visitorClasses, visitorFunnel, type VisitorStatus } from "@/lib/visitors";
import { Avatar, Hero } from "@/components/app-ui";
import { Empty, FlashMessage } from "@/components/ui";

const STATUS_CHIP: Record<VisitorStatus, string> = { visitante: "brand", retornou: "ok", matriculado: "ok", perdido: "bad" };

const whatsapp = (phone: string, name: string) => {
  const d = phone.replace(/\D/g, "");
  const n = d.length === 10 || d.length === 11 ? `55${d}` : d;
  const msg = `Olá, ${name.split(" ")[0]}! Que alegria ter você na nossa Escola Bíblica Dominical. Esperamos você no próximo domingo!`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<Flash & { s?: string; t?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = (["visitante", "retornou", "matriculado", "perdido"] as const).find((x) => x === sp.s);
  const all = guarded(() => {
    if (!canSeeSomething(user, "visitor")) throw new ForbiddenError();
    return listVisitors(user);
  });
  const shown = status ? all.filter((v) => v.status === status) : all;
  const year = Number(sp.t?.slice(0, 4)) || Number(todayISO().slice(0, 4));
  const funnel = visitorFunnel(user, `${year}-01-01`, `${year}-12-31`);
  const classes = visitorClasses(user);
  const enrollClasses = listClasses(user).filter((c) => can(user, "create", { type: "enrollment", classIds: [c.id] }));
  const today = todayISO();

  return (
    <>
      <div className="pagehead"><div><h1>Visitantes</h1><p className="muted small">Acolher, acompanhar e trazer para a classe.</p></div></div>
      <FlashMessage flash={sp} />

      <Hero
        eyebrow={`Funil de ${year}`}
        value={funnel.total}
        caption={funnel.total === 1 ? "visitante" : "visitantes"}
        stats={[
          { label: "Retornaram", value: `${funnel.retornaram}${funnel.pctRetorno !== null ? ` · ${funnel.pctRetorno}%` : ""}` },
          { label: "Matriculados", value: `${funnel.matriculados}${funnel.pctMatricula !== null ? ` · ${funnel.pctMatricula}%` : ""}` },
          { label: "Sem retorno", value: funnel.perdidos },
        ]}
      />

      {classes.length > 0 && (
        <details className="card" open={all.length === 0}>
          <summary><strong>＋ Registrar visitante</strong></summary>
          <form action={createVisitorAction} className="form-grid" style={{ marginTop: ".7rem" }}>
            <div><label htmlFor="vn">Nome</label><input id="vn" name="name" required autoComplete="off" /></div>
            <div><label htmlFor="vp">Telefone / WhatsApp</label><input id="vp" name="phone" inputMode="tel" placeholder="(11) 90000-0000" /></div>
            <div>
              <label htmlFor="vc">Classe visitada</label>
              <select id="vc" name="class_id" required>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label htmlFor="vd">Data</label><input id="vd" name="date" type="date" defaultValue={today} required /></div>
            <div>
              <label htmlFor="vh">Como conheceu</label>
              <select id="vh" name="how_found"><option value="">—</option>{HOW_FOUND.map((h) => <option key={h}>{h}</option>)}</select>
            </div>
            <div><label htmlFor="vi">Convidado por</label><input id="vi" name="invited_by" /></div>
            <div><label htmlFor="vo">Observações</label><input id="vo" name="notes" placeholder="pedido de oração, família…" /></div>
            <button type="submit">Registrar</button>
          </form>
        </details>
      )}

      <nav className="chips" aria-label="Situação">
        <Link href="/visitantes" className={!status ? "active" : ""}>Todos ({all.length})</Link>
        {(Object.keys(VISITOR_LABEL) as VisitorStatus[]).map((s) => (
          <Link key={s} href={`/visitantes?s=${s}`} className={status === s ? "active" : ""}>{VISITOR_LABEL[s]} ({all.filter((v) => v.status === s).length})</Link>
        ))}
      </nav>

      {shown.length === 0 ? <Empty>Nenhum visitante aqui.</Empty> : (
        <div className="list">
          {shown.map((v) => {
            const res = { type: "visitor" as const, classIds: v.class_id ? [v.class_id] : [], congregationId: v.congregation_id };
            const canUpdate = can(user, "update", res);
            return (
              <div key={v.id} className="list-card">
                <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <Avatar name={v.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ flexWrap: "nowrap" }}>
                      <strong>{v.name}</strong>
                      <span className={`chip ${STATUS_CHIP[v.status]}`}><i />{VISITOR_LABEL[v.status]}</span>
                    </div>
                    <div className="small muted">
                      {v.class_name ?? "—"} · {v.visits} visita(s) · última {v.last_visit ? fmtDate(v.last_visit) : "—"}
                      {v.how_found ? ` · ${v.how_found}` : ""}{v.invited_by ? ` · convite de ${v.invited_by}` : ""}
                    </div>
                    {v.notes && <div className="small">{v.notes}</div>}
                    <div className="row" style={{ marginTop: ".4rem" }}>
                      {v.phone && <a className="btn ghost small" href={whatsapp(v.phone, v.name)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                      {v.status !== "matriculado" && can(user, "create", res) && (
                        <form action={addVisitAction}>
                          <input type="hidden" name="visitor_id" value={v.id} />
                          <input type="hidden" name="date" value={today} />
                          <button className="ghost small" type="submit">＋ Visitou hoje</button>
                        </form>
                      )}
                      {v.status !== "matriculado" && canUpdate && (
                        <form action={setVisitorStatusAction}>
                          <input type="hidden" name="visitor_id" value={v.id} />
                          <input type="hidden" name="status" value={v.status === "perdido" ? "visitante" : "perdido"} />
                          <button className="ghost small" type="submit">{v.status === "perdido" ? "Reativar" : "Sem retorno"}</button>
                        </form>
                      )}
                      {v.status === "matriculado" && v.person_id && <Link className="btn ghost small" href={`/pessoas/${v.person_id}`}>Ver ficha</Link>}
                      {can(user, "delete", res) && (
                        <form action={deleteVisitorAction}>
                          <input type="hidden" name="visitor_id" value={v.id} />
                          <button className="danger small" type="submit" aria-label={`Excluir ${v.name}`}>Excluir</button>
                        </form>
                      )}
                    </div>
                    {v.status !== "matriculado" && canUpdate && enrollClasses.length > 0 && (
                      <details style={{ marginTop: ".4rem" }}>
                        <summary className="small">Matricular como aluno</summary>
                        <form action={enrollVisitorAction} className="form-grid" style={{ marginTop: ".5rem" }}>
                          <input type="hidden" name="visitor_id" value={v.id} />
                          <div>
                            <label>Classe</label>
                            <select name="class_id" defaultValue={v.class_id ?? undefined}>
                              {enrollClasses.filter((c) => c.congregation_id === v.congregation_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div><label>Nascimento</label><input name="birth_date" type="date" /></div>
                          <button type="submit" className="small">Matricular</button>
                        </form>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
