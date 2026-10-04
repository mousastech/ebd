import { ClassBrowser } from "@/components/ClassBrowser";
import { createClassAction, createGroupAction, setGroupCoordinatorAction } from "@/app/actions";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { guarded, type Flash } from "@/lib/guard";
import { listClassCards, listGroups, listPeople } from "@/lib/repo";
import { Empty, FlashMessage } from "@/components/ui";

export default async function ClassesPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const cards = guarded(() => listClassCards(user));
  const groups = guarded(() => listGroups(user));
  const canCreate = can(user, "create", { type: "class" });
  const canDesignate = can(user, "update", { type: "user" }); // só o superintendente designa coordenador
  const people = canDesignate ? listPeople(user) : [];
  const loose = cards.filter((c) => !groups.some((g) => g.id === c.group_id));

  const browserGroups = groups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Turmas</h1>
          <p className="muted small">{cards.length} ativas · {groups.length} Escala(s)</p>
        </div>
      </div>
      <FlashMessage flash={flash} />
      {cards.length === 0 ? <Empty>Você ainda não está vinculado a nenhuma classe.</Empty> : (
        <ClassBrowser cards={cards} groups={browserGroups} />
      )}
      {loose.length > 0 && canCreate && <p className="note small">{loose.length} classe(s) sem Escala — mova-as na página da classe.</p>}

      {groups.length > 0 && (
        <>
          <h2>Escalas e coordenadores</h2>
          <div className="list">
            {groups.map((g) => (
              <div key={g.id} className="list-card">
                <div className="row between">
                  <strong>{g.name}</strong>
                  <span className="small muted">{g.classes.length} classe(s)</span>
                </div>
                <div className="small">Coordenador(a): <strong>{g.coordinator ?? "não designado"}</strong></div>
                <div className="small muted">{g.classes.map((c) => c.name).join(" · ")}</div>
                {canDesignate && (
                  <form action={setGroupCoordinatorAction} className="row" style={{ marginTop: ".4rem" }}>
                    <input type="hidden" name="group_id" value={g.id} />
                    <select name="person_id" defaultValue={g.coordinator_id ?? ""} aria-label={`Coordenador(a) da ${g.name}`} style={{ flex: 1, minWidth: 0 }}>
                      <option value="">— nenhum —</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="submit" className="small">Designar</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {canCreate && <a href="#nova" className="fab">＋ Nova</a>}
      {canCreate && (
        <div className="grid" id="nova">
          <form action={createGroupAction} className="card">
            <h2 style={{ marginTop: 0 }}>Nova escala</h2>
            <div className="form-grid">
              <div><label htmlFor="gn">Nome</label><input id="gn" name="name" required placeholder="ex.: Escala 4" /></div>
              <div>
                <label htmlFor="gp">Coordenador(a)</label>
                <select id="gp" name="person_id"><option value="">— depois —</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button type="submit">Criar escala</button>
            </div>
          </form>
          <form action={createClassAction} className="card">
            <h2 style={{ marginTop: 0 }}>Nova classe</h2>
            <div className="form-grid">
              <div><label htmlFor="n">Nome</label><input id="n" name="name" required /></div>
              <div><label htmlFor="a">Faixa etária</label><input id="a" name="age_range" placeholder="ex.: 15 a 29 anos" /></div>
              <div>
                <label htmlFor="g">Escala</label>
                <select id="g" name="group_id"><option value="">—</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <button type="submit">Criar classe</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
