import { createCongregationAction, setSupervisorCongregationsAction, switchCongregationAction, updateCongregationAction } from "@/app/actions-church";
import { requireUser } from "@/lib/auth";
import { listCongregations, supervisorCongregations } from "@/lib/church";
import { guarded, type Flash } from "@/lib/guard";
import { listUsers } from "@/lib/repo";
import { Hero } from "@/components/app-ui";
import { Empty, FlashMessage } from "@/components/ui";

/** Trocar de congregação (sede e filiais), visão consolidada e cadastro de filiais e supervisores. */
export default async function CongregationsPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const all = guarded(() => listCongregations(user));
  const current = all.find((c) => c.id === user.view) ?? null;
  const multi = all.length > 1;
  const isPastor = user.role === "pastor";
  const supervisors = isPastor ? listUsers({ ...user, view: null }).filter((x) => x.role === "supervisor") : [];
  const totalStudents = all.reduce((n, c) => n + c.students, 0);

  return (
    <>
      <div className="pagehead"><div><h1>Congregações</h1><p className="muted small">Sede e filiais que você acompanha.</p></div></div>
      <FlashMessage flash={flash} />

      <Hero
        eyebrow={current ? (current.kind === "sede" ? "Igreja atual · Sede" : "Igreja atual · Filial") : "Visão consolidada"}
        icon="⛪"
        value={current ? current.name : `${all.length} congregações`}
        stats={[
          { label: "Classes", value: current ? current.classes : all.reduce((n, c) => n + c.classes, 0) },
          { label: "Alunos", value: current ? current.students : totalStudents },
          { label: "Congregações", value: all.length },
        ]}
      />
      {multi && !current && (
        <div className="hint">Você está vendo os dados <strong>somados</strong> de todas as congregações que acompanha.</div>
      )}

      <h3 className="section-label">{multi ? "Trocar congregação" : "Sua congregação"}</h3>
      <div className="list">
        {multi && (
          <form action={switchCongregationAction} className="list-card">
            <input type="hidden" name="congregation_id" value="0" />
            <input type="hidden" name="next" value="/" />
            <div className="row between" style={{ flexWrap: "nowrap" }}>
              <span><strong>Visão consolidada</strong><br /><span className="small muted">Todas as congregações · {totalStudents} alunos</span></span>
              {current ? <button className="ghost small" type="submit">⇄ Ver</button> : <span className="chip ok"><i />Atual</span>}
            </div>
          </form>
        )}
        {all.map((c) => (
          <form key={c.id} action={switchCongregationAction} className="list-card">
            <input type="hidden" name="congregation_id" value={c.id} />
            <input type="hidden" name="next" value="/" />
            <div className="row between" style={{ flexWrap: "nowrap" }}>
              <span>
                <strong>{c.name}</strong> {c.kind === "sede" && <span className="badge">Sede</span>}
                <br /><span className="small muted">{c.classes} classes · {c.students} alunos{c.region ? ` · ${c.region}` : ""}</span>
              </span>
              {multi && (current?.id === c.id ? <span className="chip ok"><i />Atual</span> : <button className="ghost small" type="submit">⇄ Entrar</button>)}
            </div>
          </form>
        ))}
      </div>
      {all.length === 0 && <Empty>Nenhuma congregação disponível.</Empty>}

      {isPastor && (
        <>
          <h2>Cadastro de congregações</h2>
          <div className="list">
            {all.map((c) => (
              <details key={c.id} className="list-card">
                <summary><strong>{c.name}</strong> <span className="muted small">— editar</span></summary>
                <form action={updateCongregationAction} className="form-grid" style={{ marginTop: ".6rem" }}>
                  <input type="hidden" name="id" value={c.id} />
                  <div><label>Nome</label><input name="name" defaultValue={c.name} required /></div>
                  <div><label>Região</label><input name="region" defaultValue={c.region ?? ""} placeholder="ex.: Região Norte" /></div>
                  <div><label>Endereço</label><input name="address" defaultValue={c.address ?? ""} /></div>
                  <button type="submit" className="small">Salvar</button>
                </form>
              </details>
            ))}
          </div>
          <form action={createCongregationAction} className="card" id="nova">
            <h3>Nova filial</h3>
            <div className="form-grid">
              <div><label htmlFor="cn">Nome</label><input id="cn" name="name" required placeholder="ex.: Congregação Betel" /></div>
              <div><label htmlFor="cr">Região</label><input id="cr" name="region" placeholder="ex.: Região Norte" /></div>
              <div><label htmlFor="ca">Endereço</label><input id="ca" name="address" /></div>
              <button type="submit">Criar filial</button>
            </div>
          </form>

          <h2>Supervisores regionais</h2>
          <p className="muted small">O supervisor consulta (sem alterar) as congregações marcadas. Crie o acesso com a função “Supervisor regional” em Usuários.</p>
          {supervisors.length === 0 ? <Empty>Nenhum supervisor cadastrado.</Empty> : supervisors.map((s) => {
            const mine = new Set(supervisorCongregations(s.id));
            return (
              <form key={s.id} action={setSupervisorCongregationsAction} className="card">
                <input type="hidden" name="user_id" value={s.id} />
                <strong>{s.name}</strong> <span className="muted small">{s.email}</span>
                <div className="checks" style={{ margin: ".6rem 0" }}>
                  {all.map((c) => (
                    <label key={c.id} className="check"><input type="checkbox" name="congregation_id" value={c.id} defaultChecked={mine.has(c.id)} /> {c.name}</label>
                  ))}
                </div>
                <button type="submit" className="small">Salvar região</button>
              </form>
            );
          })}
        </>
      )}
    </>
  );
}
