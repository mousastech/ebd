"use server";

import { file, num, runAsync, str } from "@/lib/action-run";
import * as agenda from "@/lib/agenda";
import * as ann from "@/lib/announcements";
import * as mural from "@/lib/mural";
import { requireUser } from "@/lib/auth";
import { markAllRead } from "@/lib/notify";
import { UserError } from "@/lib/repo";
import { removeUpload, saveUpload } from "@/lib/uploads";
import { revalidatePath } from "next/cache";

// ───────────── comunicados
export async function createAnnouncementAction(f: FormData) {
  await runAsync("/comunicados", "Comunicado publicado.", (u) =>
    void ann.createAnnouncement(u, {
      audience: str(f, "audience"), title: str(f, "title"), body: str(f, "body"), pinned: f.has("pinned"),
      expiresAt: str(f, "expires_at"), allCongregations: f.has("all"), notify: f.has("notify"),
    }),
  );
}
export async function deleteAnnouncementAction(f: FormData) {
  await runAsync("/comunicados", "Comunicado excluído.", (u) => ann.deleteAnnouncement(u, num(f, "id")));
}
export async function pinAnnouncementAction(f: FormData) {
  await runAsync("/comunicados", "Comunicado atualizado.", (u) => ann.togglePin(u, num(f, "id")));
}

// ───────────── agenda
export async function createEventAction(f: FormData) {
  await runAsync("/agenda", "Evento criado.", (u) =>
    void agenda.createEvent(u, {
      audience: str(f, "audience"), title: str(f, "title"), description: str(f, "description"), location: str(f, "location"),
      startsAt: str(f, "starts_at"), endsAt: str(f, "ends_at"), rsvp: f.has("rsvp"), allCongregations: f.has("all"), notify: f.has("notify"),
    }),
  );
}
export async function deleteEventAction(f: FormData) {
  await runAsync("/agenda", "Evento excluído.", (u) => agenda.deleteEvent(u, num(f, "id")));
}
export async function rsvpAction(f: FormData) {
  const a = str(f, "answer") as agenda.Rsvp;
  await runAsync("/agenda", a === "sim" ? "Presença confirmada. Te esperamos!" : "Resposta registrada.", (u) =>
    agenda.answerRsvp(u, num(f, "event_id"), a, num(f, "guests")),
  );
}
export async function rotateCalendarTokenAction() {
  await runAsync("/agenda", "Novo link do calendário gerado (o anterior deixou de funcionar).", (u) => void agenda.calendarToken(u, true));
}

// ───────────── mural
export async function createPostAction(f: FormData) {
  await runAsync("/mural", "Publicado! (publicações de alunos aparecem após aprovação)", async (u) => {
    const img = file(f, "image");
    let rel: string | null = null;
    if (img) rel = (await saveUpload(img, "mural", { accept: ["image"], maxBytes: 6 * 1024 * 1024 })).rel;
    try {
      mural.createPost(u, { kind: str(f, "kind"), body: str(f, "body"), image: rel, classId: num(f, "class_id") || null });
    } catch (e) {
      removeUpload(rel);
      throw e;
    }
  });
}
export async function moderatePostAction(f: FormData) {
  const a = str(f, "action") === "aprovar" ? "aprovar" : "ocultar";
  await runAsync(`/mural${str(f, "back")}`, a === "aprovar" ? "Publicação aprovada." : "Publicação ocultada.", (u) => mural.moderatePost(u, num(f, "id"), a));
}
export async function deletePostAction(f: FormData) {
  await runAsync("/mural", "Publicação excluída.", (u) => mural.deletePost(u, num(f, "id")));
}
export async function amenAction(f: FormData) {
  const u = await requireUser();
  try {
    mural.toggleAmen(u, num(f, "id"));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  revalidatePath("/mural");
}
export async function commentAction(f: FormData) {
  await runAsync("/mural", "Comentário enviado.", (u) => mural.addComment(u, num(f, "id"), str(f, "body")));
}
export async function deleteCommentAction(f: FormData) {
  await runAsync("/mural", "Comentário excluído.", (u) => mural.deleteComment(u, num(f, "id")));
}

// ───────────── notificações
export async function markNotificationsReadAction() {
  const u = await requireUser();
  markAllRead(u);
  revalidatePath("/", "layout");
}
