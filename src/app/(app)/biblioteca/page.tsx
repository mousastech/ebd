import Link from "next/link";
import { createLibraryItemAction, deleteLibraryItemAction, lendAction, returnLoanAction } from "@/app/actions-ensino";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { fmtDate, todayISO } from "@/lib/format";
import { type Flash } from "@/lib/guard";
import { listLibrary, listLoans, type ItemKind } from "@/lib/library";
import { listClasses, listPeople } from "@/lib/repo";
import { Empty, FlashMessage } from "@/components/ui";

const KIND: Record<ItemKind, string> = { arquivo: "📄 Arquivos", link: "🔗 Links e vídeos", livro: "📚 Acervo (livros)" };
const kb = (n: number | null) => (n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const addDays = (n: number) => { const d = new Date(`${todayISO()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Flash & { tipo?: string; q?: string; aba?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = (["arquivo", "link", "livro"] as const).find((k) => k === sp.tipo);
  const loansTab = sp.aba === "emprestimos";
  const items = listLibrary(user, { kind, q: sp.q });
  const all = listLibrary(user);
  const cong = user.view ?? user.home ?? 1;
  const createClasses = listClasses(user).filter((c) => can(user, "create", { type: "library", classIds: [c.id], congregationId: c.congregation_id }));
  const canGeneral = can(user, "create", { type: "library", congregationId: cong });
  const canLoans = can(user, "create", { type: "loan", congregationId: cong });
  const loans = listLoans(user, { open: false });
  const myLoans = loans.filter((l) => l.person_id === user.personId && !l.returned_at);
  const people = loansTab && canLoans ? listPeople(user) : [];

  return (
    <>
      <div className="pagehead"><div><h1>Biblioteca</h1><p className="muted small">Materiais de estudo, slides, vídeos e o acervo de livros.</p></div></div>
      <FlashMessage flash={sp} />
      <nav className="chips">
        <Link href="/biblioteca" className={!kind && !loansTab ? "active" : ""}>Tudo ({all.length})</Link>
        {(Object.keys(KIND) as ItemKind[]).map((k) => (
          <Link key={k} href={`/biblioteca?tipo=${k}`} className={kind === k ? "active" : ""}>{KIND[k]} ({all.filter((i) => i.kind === k).length})</Link>
        ))}
        {(canLoans || loans.length > 0) && <Link href="/biblioteca?aba=emprestimos" className={loansTab ? "active" : ""}>Empréstimos ({loans.filter((l) => !l.returned_at).length})</Link>}
      </nav>
      {myLoans.length > 0 && !loansTab && (
        <div className="note">Você está com {myLoans.map((l) => `“${l.title}” (devolver até ${fmtDate(l.due_at)})`).join(", ")}.</div>
      )}

      {!loansTab && (
        <>
          <form className="search" action="/biblioteca">
            <span aria-hidden="true">⌕</span>
            {kind && <input type="hidden" name="tipo" value={kind} />}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por título, autor ou assunto…" aria-label="Buscar na biblioteca" />
          </form>

          {(createClasses.length > 0 || canGeneral) && (
            <details className="card">
              <summary><strong>＋ Adicionar à biblioteca</strong></summary>
              <form action={createLibraryItemAction} className="form-grid" style={{ marginTop: ".6rem" }}>
                <div>
                  <label htmlFor="lk">Tipo</label>
                  <select id="lk" name="kind">
                    <option value="arquivo">Arquivo (PDF, slides, imagem)</option>
                    <option value="link">Link (vídeo, estudo, site)</option>
                    {canGeneral && <option value="livro">Livro do acervo</option>}
                  </select>
                </div>
                <div><label htmlFor="lt">Título</label><input id="lt" name="title" required /></div>
                <div><label htmlFor="lf">Arquivo (até 10 MB)</label><input id="lf" name="file" type="file" accept=".pdf,.pptx,.docx,.xlsx,image/*" /></div>
                <div><label htmlFor="lu">Link</label><input id="lu" name="url" type="url" placeholder="https://" /></div>
                <div><label htmlFor="la">Autor (livros)</label><input id="la" name="author" /></div>
                <div><label htmlFor="lc">Exemplares (livros)</label><input id="lc" name="copies" type="number" min={1} defaultValue={1} /></div>
                <div>
                  <label htmlFor="lcl">Classe</label>
                  <select id="lcl" name="class_id">
                    {canGeneral && <option value="">Toda a EBD</option>}
                    {createClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div><label htmlFor="lau">Quem vê</label><select id="lau" name="audience"><option value="todos">Todos</option><option value="equipe">Só a equipe (professores)</option></select></div>
                <div><label htmlFor="ld">Descrição</label><input id="ld" name="description" /></div>
                <button type="submit">Adicionar</button>
              </form>
            </details>
          )}

          {items.length === 0 ? <Empty>Nada encontrado.</Empty> : (
            <div className="list">
              {items.map((i) => (
                <div key={i.id} className="list-card lib-item">
                  <span className="lib-ic" aria-hidden="true">{i.kind === "livro" ? "📚" : i.kind === "link" ? "🔗" : i.mime?.includes("pdf") ? "📄" : i.mime?.startsWith("image/") ? "🖼️" : i.mime?.includes("presentation") ? "📊" : "📎"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{i.title}</strong>
                    <div className="small muted">
                      {[i.author, i.class_name ?? "Toda a EBD", i.audience === "equipe" ? "só equipe" : null, i.kind === "arquivo" ? kb(i.size) : null,
                        i.kind === "livro" ? `${i.copies - i.on_loan}/${i.copies} disponível(is)` : null].filter(Boolean).join(" · ")}
                    </div>
                    {i.description && <div className="small">{i.description}</div>}
                    <div className="row" style={{ marginTop: ".4rem" }}>
                      {i.file && <a className="btn small" href={`/arquivos/${i.file}`} target="_blank" rel="noopener noreferrer">Abrir</a>}
                      {i.url && <a className="btn small" href={i.url} target="_blank" rel="noopener noreferrer">Abrir link</a>}
                      {i.canEdit && <form action={deleteLibraryItemAction}><input type="hidden" name="id" value={i.id} /><button className="danger small" type="submit">Excluir</button></form>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {loansTab && (
        <>
          {canLoans && (
            <form action={lendAction} className="card form-grid">
              <div>
                <label htmlFor="li">Livro</label>
                <select id="li" name="item_id" required>
                  {all.filter((i) => i.kind === "livro" && i.copies > i.on_loan).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="lp">Para</label>
                <select id="lp" name="person_id" required>
                  <option value="">Selecione…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div><label htmlFor="ldu">Devolver até</label><input id="ldu" name="due_at" type="date" defaultValue={addDays(14)} required /></div>
              <button type="submit">Emprestar</button>
            </form>
          )}
          {loans.length === 0 ? <Empty>Nenhum empréstimo.</Empty> : (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Livro</th><th>Com</th><th>Desde</th><th>Devolver até</th><th></th></tr></thead>
                <tbody>
                  {loans.map((l) => (
                    <tr key={l.id}>
                      <td>{l.title}</td><td>{l.person}</td><td className="nowrap">{fmtDate(l.loaned_at)}</td>
                      <td className="nowrap">{l.returned_at ? <span className="muted">devolvido {fmtDate(l.returned_at)}</span> : <span className={l.late ? "badge bad" : ""}>{fmtDate(l.due_at)}{l.late ? " · atrasado" : ""}</span>}</td>
                      <td className="right">{!l.returned_at && canLoans && <form action={returnLoanAction}><input type="hidden" name="id" value={l.id} /><button className="ghost small" type="submit">Devolvido</button></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
