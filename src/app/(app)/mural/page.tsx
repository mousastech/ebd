import Link from "next/link";
import { amenAction, commentAction, createPostAction, deleteCommentAction, deletePostAction, moderatePostAction } from "@/app/actions-comunicacao";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { type Flash } from "@/lib/guard";
import { listPosts, POST_KIND_LABEL } from "@/lib/mural";
import { listClasses } from "@/lib/repo";
import { Avatar } from "@/components/app-ui";
import { PhotoInput } from "@/components/PhotoInput";
import { Empty, FlashMessage } from "@/components/ui";

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function MuralPage({ searchParams }: { searchParams: Promise<Flash & { aba?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const pending = sp.aba === "pendentes";
  const posts = listPosts(user, { pendingOnly: pending });
  const pendingCount = listPosts(user, { pendingOnly: true }).filter((p) => p.canModerate).length;
  const myClasses = listClasses(user).filter((c) => can(user, "create", { type: "post", classIds: [c.id], congregationId: c.congregation_id }));

  return (
    <>
      <div className="pagehead"><div><h1>Mural</h1><p className="muted small">Fotos das aulas, testemunhos e pedidos de oração.</p></div></div>
      <FlashMessage flash={sp} />
      {pendingCount > 0 || pending ? (
        <nav className="chips">
          <Link href="/mural" className={!pending ? "active" : ""}>Publicações</Link>
          <Link href="/mural?aba=pendentes" className={pending ? "active" : ""}>Aguardando aprovação ({pendingCount})</Link>
        </nav>
      ) : null}

      {!pending && (
        <form action={createPostAction} className="card composer">
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <Avatar name={user.name} photo={user.photo} />
            <textarea name="body" placeholder="Compartilhe uma foto da aula, um testemunho ou um pedido de oração…" maxLength={2000} style={{ minHeight: "4rem" }} />
          </div>
          <div className="row" style={{ marginTop: ".5rem" }}>
            <select name="kind" aria-label="Tipo" style={{ maxWidth: 200 }}>
              {Object.entries(POST_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {myClasses.length > 0 && (
              <select name="class_id" aria-label="Classe" style={{ maxWidth: 220 }}>
                <option value="">Toda a EBD</option>
                {myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <PhotoInput name="image" label="📷 Foto" maxSide={1600} capture="environment" required={false} />
            <button type="submit">Publicar</button>
          </div>
          {user.role === "aluno" && user.secretaryOf.length === 0 && <p className="small muted" style={{ margin: ".4rem 0 0" }}>Sua publicação aparece depois da aprovação da equipe.</p>}
        </form>
      )}

      {posts.length === 0 ? <Empty>{pending ? "Nada aguardando aprovação." : "Ainda não há publicações. Que tal começar?"}</Empty> : (
        <div className="feed">
          {posts.map((p) => (
            <article key={p.id} className="list-card post">
              <header className="row" style={{ flexWrap: "nowrap" }}>
                <Avatar name={p.author} photo={p.author_photo} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{p.author}</strong>
                  <div className="small muted">{when(p.created_at)} · {POST_KIND_LABEL[p.kind]}{p.class_name ? ` · ${p.class_name}` : ""}</div>
                </div>
                {p.status === "pendente" && <span className="chip"><i />Aguardando</span>}
              </header>
              {p.body && <p className="announce-body">{p.body}</p>}
              {p.image && <img src={`/arquivos/${p.image}`} alt={p.body ?? "Foto do mural"} className="post-img" loading="lazy" />}
              <div className="row post-actions">
                {p.status === "publicado" && (
                  <form action={amenAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={`small ${p.mine ? "" : "ghost"}`}>🙏 Amém{p.amens ? ` · ${p.amens}` : ""}</button>
                  </form>
                )}
                {p.canModerate && p.status === "pendente" && (
                  <form action={moderatePostAction}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="action" value="aprovar" /><input type="hidden" name="back" value="?aba=pendentes" />
                    <button type="submit" className="small">Aprovar</button>
                  </form>
                )}
                {p.canModerate && (
                  <form action={moderatePostAction}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="action" value="ocultar" /><input type="hidden" name="back" value={pending ? "?aba=pendentes" : ""} />
                    <button type="submit" className="ghost small">Ocultar</button>
                  </form>
                )}
                {p.canDelete && (
                  <form action={deletePostAction}><input type="hidden" name="id" value={p.id} /><button type="submit" className="danger small">Excluir</button></form>
                )}
              </div>
              {p.status === "publicado" && (
                <div className="comments">
                  {p.comments.map((c) => (
                    <div key={c.id} className="comment small">
                      <strong>{c.name}</strong> {c.body}
                      {c.canDelete && (
                        <form action={deleteCommentAction} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="linkish" aria-label="Excluir comentário">✕</button>
                        </form>
                      )}
                    </div>
                  ))}
                  <form action={commentAction} className="row" style={{ flexWrap: "nowrap", marginTop: ".3rem" }}>
                    <input type="hidden" name="id" value={p.id} />
                    <input name="body" placeholder="Escreva um comentário…" maxLength={500} required aria-label="Comentário" />
                    <button type="submit" className="ghost small">Enviar</button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
