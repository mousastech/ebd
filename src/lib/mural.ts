/**
 * Mural da EBD: fotos das aulas, testemunhos, pedidos de oração e avisos rápidos.
 * Publicações de alunos passam por aprovação (secretaria, superintendência ou coordenador da classe).
 */
import { authorize, can, type Resource, type Subject } from "./abac";
import { db } from "./db";
import { notifyUsers, usersWhere } from "./notify";
import { UserError } from "./repo";
import { removeUpload } from "./uploads";

type Id = number;
export type PostKind = "foto" | "testemunho" | "aviso" | "oracao";
export const POST_KIND_LABEL: Record<PostKind, string> = { foto: "📷 Foto", testemunho: "🙌 Testemunho", aviso: "📌 Aviso", oracao: "🙏 Pedido de oração" };

export interface Post {
  id: Id;
  congregation_id: Id;
  class_id: Id | null;
  class_name: string | null;
  author_id: Id;
  author: string;
  author_photo: string | null;
  kind: PostKind;
  body: string | null;
  image: string | null;
  status: "publicado" | "pendente" | "oculto";
  created_at: string;
  amens: number;
  mine: boolean;
  comments: { id: Id; person_id: Id; name: string; body: string; created_at: string; canDelete: boolean }[];
  canModerate: boolean;
  canDelete: boolean;
}

const pres = (p: { congregation_id: Id; class_id: Id | null }): Resource => ({
  type: "post", congregationId: p.congregation_id, classIds: p.class_id ? [p.class_id] : [],
});

function rawPost(id: Id) {
  const p = db().prepare(`SELECT id, congregation_id, class_id, author_id, image, status FROM posts WHERE id=?`).get(id) as
    | { id: Id; congregation_id: Id; class_id: Id | null; author_id: Id; image: string | null; status: string } | undefined;
  if (!p) throw new UserError("Publicação não encontrada.");
  return p;
}

const reach = (u: Subject, cong: Id) => u.congregations == null || u.congregations.includes(cong);

/** Pode ver a publicação: da sua congregação; pendentes só o autor e quem modera. */
function canSee(u: Subject, p: { congregation_id: Id; class_id: Id | null; author_id: Id; status: string }): boolean {
  if (!reach(u, p.congregation_id) || !can(u, "read", { type: "post", congregationId: p.congregation_id })) return false;
  if (p.status === "publicado") return true;
  return p.author_id === u.personId || can(u, "update", pres(p));
}

export function listPosts(u: Subject, opts: { limit?: number; pendingOnly?: boolean } = {}): Post[] {
  const rows = db()
    .prepare(`SELECT po.*, pe.name AS author, pe.photo AS author_photo, c.name AS class_name,
                     (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id=po.id) AS amens,
                     EXISTS(SELECT 1 FROM post_reactions r WHERE r.post_id=po.id AND r.person_id=?) AS mine
                FROM posts po JOIN people pe ON pe.id=po.author_id LEFT JOIN classes c ON c.id=po.class_id
               ${opts.pendingOnly ? "WHERE po.status='pendente'" : "WHERE po.status <> 'oculto'"}
               ORDER BY po.id DESC LIMIT ?`)
    .all(u.personId, opts.limit ?? 60) as (Omit<Post, "comments" | "canModerate" | "canDelete" | "mine"> & { mine: number })[];
  const visible = rows.filter((p) => (u.view == null || p.congregation_id === u.view) && canSee(u, p));
  const comments = visible.length
    ? (db()
        .prepare(`SELECT cm.id, cm.post_id, cm.person_id, pe.name, cm.body, cm.created_at FROM post_comments cm JOIN people pe ON pe.id=cm.person_id
                   WHERE cm.post_id IN (${visible.map(() => "?").join(",")}) ORDER BY cm.id`)
        .all(...visible.map((p) => p.id)) as { id: Id; post_id: Id; person_id: Id; name: string; body: string; created_at: string }[])
    : [];
  return visible.map((p) => {
    const canModerate = can(u, "update", pres(p));
    return {
      ...p,
      mine: !!p.mine,
      canModerate,
      canDelete: canModerate || p.author_id === u.personId,
      comments: comments.filter((c) => c.post_id === p.id).map((c) => ({ ...c, canDelete: c.person_id === u.personId || canModerate })),
    };
  });
}

export function createPost(u: Subject, d: { kind: string; body: string; image: string | null; classId: Id | null }): { id: Id; status: string } {
  const kind = (["foto", "testemunho", "aviso", "oracao"] as const).find((k) => k === d.kind) ?? "foto";
  const cong = d.classId
    ? ((db().prepare(`SELECT congregation_id FROM classes WHERE id=?`).get(d.classId) as { congregation_id: Id } | undefined)?.congregation_id ?? null)
    : u.view ?? u.home ?? 1;
  if (cong === null) throw new UserError("Classe não encontrada.");
  if (!reach(u, cong)) throw new UserError("Congregação inválida.");
  authorize(u, "create", { type: "post", congregationId: cong, classIds: d.classId ? [d.classId] : [] });
  if (!d.body.trim() && !d.image) throw new UserError("Escreva algo ou envie uma foto.");
  if (kind === "foto" && !d.image) throw new UserError("Escolha a foto.");
  // aluno publica com aprovação; quem modera (ou é da equipe) publica direto
  const staff = u.role !== "aluno" || u.secretaryOf.length > 0;
  const status = staff ? "publicado" : "pendente";
  const id = Number(
    db()
      .prepare(`INSERT INTO posts (congregation_id, class_id, author_id, kind, body, image, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cong, d.classId, u.personId, kind, d.body.trim().slice(0, 2000) || null, d.image, status, new Date().toISOString())
      .lastInsertRowid,
  );
  if (status === "pendente") {
    const r = { congregation_id: cong, class_id: d.classId };
    notifyUsers(usersWhere((s) => can(s, "update", pres(r)) && reach(s, cong) && s.role !== "pastor" && s.role !== "supervisor"),
      { title: "Mural: publicação aguardando aprovação", body: d.body.slice(0, 100), url: "/mural?aba=pendentes" });
  }
  return { id, status };
}

export function moderatePost(u: Subject, id: Id, action: "aprovar" | "ocultar"): void {
  const p = rawPost(id);
  authorize(u, "update", pres(p));
  db().prepare(`UPDATE posts SET status=? WHERE id=?`).run(action === "aprovar" ? "publicado" : "oculto", id);
  if (action === "aprovar" && p.status === "pendente") {
    const uid = db().prepare(`SELECT id FROM users WHERE person_id=?`).get(p.author_id) as { id: Id } | undefined;
    if (uid) notifyUsers([uid.id], { title: "Sua publicação foi aprovada no mural 🙌", url: "/mural" });
  }
}

export function deletePost(u: Subject, id: Id): void {
  const p = rawPost(id);
  if (p.author_id !== u.personId) authorize(u, "delete", pres(p));
  db().prepare(`DELETE FROM posts WHERE id=?`).run(id);
  removeUpload(p.image);
}

export function toggleAmen(u: Subject, id: Id): void {
  const p = rawPost(id);
  if (!canSee(u, p) || p.status !== "publicado") throw new UserError("Publicação indisponível.");
  const r = db().prepare(`DELETE FROM post_reactions WHERE post_id=? AND person_id=?`).run(id, u.personId);
  if (r.changes === 0) db().prepare(`INSERT INTO post_reactions (post_id, person_id) VALUES (?, ?)`).run(id, u.personId);
}

export function addComment(u: Subject, id: Id, body: string): void {
  const p = rawPost(id);
  if (!canSee(u, p) || p.status !== "publicado") throw new UserError("Publicação indisponível.");
  if (!body.trim()) throw new UserError("Escreva o comentário.");
  db().prepare(`INSERT INTO post_comments (post_id, person_id, body, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, u.personId, body.trim().slice(0, 500), new Date().toISOString());
}

export function deleteComment(u: Subject, commentId: Id): void {
  const c = db().prepare(`SELECT post_id, person_id FROM post_comments WHERE id=?`).get(commentId) as { post_id: Id; person_id: Id } | undefined;
  if (!c) throw new UserError("Comentário não encontrado.");
  if (c.person_id !== u.personId) authorize(u, "delete", pres(rawPost(c.post_id)));
  db().prepare(`DELETE FROM post_comments WHERE id=?`).run(commentId);
}

/** Leitura de imagens do mural: só quem pode ver a publicação. */
export function canReadMuralImage(u: Subject, rel: string): boolean {
  const p = db().prepare(`SELECT congregation_id, class_id, author_id, status FROM posts WHERE image=?`).get(rel) as
    | { congregation_id: Id; class_id: Id | null; author_id: Id; status: string } | undefined;
  return !!p && canSee(u, p);
}
