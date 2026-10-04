import { createAnnouncementAction, deleteAnnouncementAction, pinAnnouncementAction } from "@/app/actions-comunicacao";
import { requireUser } from "@/lib/auth";
import { audienceOptions, listAnnouncements, markAnnouncementsRead } from "@/lib/announcements";
import { type Flash } from "@/lib/guard";
import { Empty, FlashMessage } from "@/components/ui";

const when = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const items = listAnnouncements(user);
  const options = audienceOptions(user, "announcement");
  const unreadIds = items.filter((a) => !a.read).map((a) => a.id);
  markAnnouncementsRead(user, unreadIds); // ao abrir a página, ficam lidos

  return (
    <>
      <div className="pagehead"><div><h1>Comunicados</h1><p className="muted small">{items.length} comunicado(s){unreadIds.length ? ` · ${unreadIds.length} novo(s)` : ""}</p></div></div>
      <FlashMessage flash={flash} />

      {options.length > 0 && (
        <details className="card">
          <summary><strong>＋ Novo comunicado</strong></summary>
          <form action={createAnnouncementAction} className="stack" style={{ marginTop: ".7rem" }}>
            <div className="form-grid">
              <div>
                <label htmlFor="aa">Para quem</label>
                <select id="aa" name="audience">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </div>
              <div><label htmlFor="at">Título</label><input id="at" name="title" required maxLength={120} /></div>
              <div><label htmlFor="ae">Válido até (opcional)</label><input id="ae" name="expires_at" type="date" /></div>
            </div>
            <div><label htmlFor="ab">Mensagem</label><textarea id="ab" name="body" required maxLength={4000} /></div>
            <div className="row">
              <label className="check"><input type="checkbox" name="notify" defaultChecked /> Avisar no celular</label>
              <label className="check"><input type="checkbox" name="pinned" /> Fixar no topo</label>
              {user.role === "pastor" && <label className="check"><input type="checkbox" name="all" /> Todas as congregações</label>}
            </div>
            <button type="submit">Publicar</button>
          </form>
        </details>
      )}

      {items.length === 0 ? <Empty>Nenhum comunicado no momento.</Empty> : (
        <div className="list" style={{ gridTemplateColumns: "1fr" }}>
          {items.map((a) => (
            <article key={a.id} className={`list-card announce ${a.pinned ? "pinned" : ""}`}>
              <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <div>
                  {a.pinned ? <span className="chip brand"><i />Fixado</span> : null}{" "}
                  {!a.read && <span className="chip ok"><i />Novo</span>}
                  <h3 style={{ margin: ".3rem 0 .1rem" }}>{a.title}</h3>
                  <div className="small muted">{when(a.created_at)} · {a.author ?? "—"} · para: {a.audienceLabel}{a.expires_at ? ` · até ${a.expires_at.split("-").reverse().join("/")}` : ""}</div>
                </div>
              </div>
              <p className="announce-body">{a.body}</p>
              {a.canEdit && (
                <div className="row small">
                  <span className="muted">Lido por {a.reads} pessoa(s)</span>
                  <form action={pinAnnouncementAction}><input type="hidden" name="id" value={a.id} /><button className="ghost small" type="submit">{a.pinned ? "Desafixar" : "Fixar"}</button></form>
                  <form action={deleteAnnouncementAction}><input type="hidden" name="id" value={a.id} /><button className="danger small" type="submit">Excluir</button></form>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
