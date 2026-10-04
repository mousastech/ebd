import { createPersonAction, updatePersonAction } from "@/app/actions";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { listClasses, listPeople } from "@/lib/repo";
import Link from "next/link";
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SINGULAR, FN_LABEL, type Category } from "@/lib/labels";
import { Empty, FlashMessage } from "@/components/ui";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Flash & { tipo?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const all = guarded(() => listPeople(user));
  const tipo = CATEGORIES.find((c) => c === flash.tipo) as Category | undefined;
  const people = tipo ? all.filter((p) => p.categories.includes(tipo)) : all;
  const count = (c: Category) => all.filter((p) => p.categories.includes(c)).length;
  const classes = listClasses(user);
  const names = new Map(classes.map((c) => [c.id, c.name]));
  const canCreate = can(user, "create", { type: "person" });
  const enrollable = classes.filter((c) => can(user, "create", { type: "enrollment", classIds: [c.id] }));

  return (
    <>
      <div className="row between">
        <h1>Pessoas</h1>
        {canCreate && <Link className="btn ghost small" href="/pessoas/importar">⬆ Importar planilha</Link>}
      </div>
      <FlashMessage flash={flash} />

      <div className="tabs">
        <Link href="/pessoas" className={!tipo ? "active" : ""}>Todos ({all.length})</Link>
        {CATEGORIES.filter((c) => count(c) > 0).map((c) => (
          <Link key={c} href={`/pessoas?tipo=${c}`} className={tipo === c ? "active" : ""}>{CATEGORY_LABEL[c]} ({count(c)})</Link>
        ))}
      </div>

      <div className="card table-wrap">
        {people.length === 0 ? <Empty>Nenhuma pessoa visível para você.</Empty> : (
          <table>
            <thead><tr><th>Nome</th><th>Nascimento</th><th>Contato</th><th>Classes</th><th></th></tr></thead>
            <tbody>
              {people.map((p) => {
                const editable = can(user, "update", { type: "person", personId: p.id, classIds: p.classIds });
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/pessoas/${p.id}`}>{p.name}</Link>
                      <div>{p.categories.map((c) => <span className="badge" key={c} style={{ marginRight: 4 }}>{CATEGORY_SINGULAR[c]}</span>)}</div>
                      {p.guardian_name && <div className="muted small">Resp.: {p.guardian_name}</div>}
                    </td>
                    <td className="nowrap">{fmtDate(p.birth_date)}</td>
                    <td className="nowrap">{p.phone ?? <span className="muted">restrito</span>}</td>
                    <td>
                      {p.studentOf.map((c) => <span className="badge" key={`s${c}`} style={{ marginRight: 4 }}>{names.get(c) ?? c}</span>)}
                      {p.staffOf.map((s) => (
                        <span className="badge warn" key={`${s.classId}${s.function}`} style={{ marginRight: 4 }}>
                          {FN_LABEL[s.function] ?? s.function} · {names.get(s.classId) ?? s.classId}
                        </span>
                      ))}
                    </td>
                    <td className="right">
                      {editable && (
                        <details>
                          <summary className="small">Editar</summary>
                          <form action={updatePersonAction} className="stack" style={{ minWidth: 240, textAlign: "left" }}>
                            <input type="hidden" name="id" value={p.id} />
                            <div><label>Nome</label><input name="name" defaultValue={p.name} required /></div>
                            <div><label>Nascimento</label><input name="birth_date" type="date" defaultValue={p.birth_date ?? ""} /></div>
                            <div><label>Telefone</label><input name="phone" defaultValue={p.phone ?? ""} /></div>
                            <div><label>Responsável</label><input name="guardian_name" defaultValue={p.guardian_name ?? ""} /></div>
                            <button className="small" type="submit">Salvar</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {canCreate && (
        <form action={createPersonAction} className="card">
          <h2 style={{ marginTop: 0 }}>Nova pessoa</h2>
          <div className="form-grid">
            <div><label htmlFor="pn">Nome</label><input id="pn" name="name" required /></div>
            <div><label htmlFor="pb">Nascimento</label><input id="pb" name="birth_date" type="date" /></div>
            <div><label htmlFor="pt">Telefone</label><input id="pt" name="phone" /></div>
            <div><label htmlFor="pg">Responsável (menores)</label><input id="pg" name="guardian_name" /></div>
            <div>
              <label htmlFor="pc">Matricular como aluno em</label>
              <select id="pc" name="class_id">
                <option value="">— não matricular —</option>
                {enrollable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button type="submit">Cadastrar</button>
          </div>
        </form>
      )}
    </>
  );
}
