"use server";

import { num, runAsync, str } from "@/lib/action-run";
import { createFinanceEntry, deleteFinanceEntry } from "@/lib/finance";
import { parseMoney } from "@/lib/format";
import { saveStaffAttendance } from "@/lib/staffcall";
import * as v from "@/lib/visitors";

// ───────────── visitantes
export async function createVisitorAction(f: FormData) {
  const back = str(f, "back") || "/visitantes";
  await runAsync(back, "Visitante registrado. Seja bem-vindo(a)!", (u) =>
    void v.createVisitor(u, {
      name: str(f, "name"), phone: str(f, "phone"), classId: num(f, "class_id") || null, date: str(f, "date"),
      howFound: str(f, "how_found"), invitedBy: str(f, "invited_by"), notes: str(f, "notes"),
    }),
  );
}

export async function addVisitAction(f: FormData) {
  await runAsync("/visitantes", "Nova visita registrada.", (u) => v.addVisit(u, num(f, "visitor_id"), str(f, "date")));
}

export async function setVisitorStatusAction(f: FormData) {
  const s = str(f, "status") === "visitante" ? "visitante" : "perdido";
  await runAsync("/visitantes", s === "perdido" ? "Marcado como sem retorno." : "Visitante reativado.", (u) =>
    v.setVisitorStatus(u, num(f, "visitor_id"), s),
  );
}

export async function enrollVisitorAction(f: FormData) {
  await runAsync("/visitantes", "Visitante matriculado como aluno. Glória a Deus!", (u) =>
    void v.enrollVisitor(u, num(f, "visitor_id"), num(f, "class_id"), str(f, "birth_date")),
  );
}

export async function deleteVisitorAction(f: FormData) {
  await runAsync("/visitantes", "Registro removido.", (u) => v.deleteVisitor(u, num(f, "visitor_id")));
}

// ───────────── financeiro
export async function createFinanceAction(f: FormData) {
  const back = `/financeiro${str(f, "t") ? `?t=${str(f, "t")}` : ""}`;
  await runAsync(back, "Lançamento registrado.", (u) =>
    void createFinanceEntry(u, {
      kind: str(f, "kind"), category: str(f, "category"), description: str(f, "description"),
      amountCents: parseMoney(str(f, "amount")), date: str(f, "date"), classId: num(f, "class_id") || null, method: str(f, "method"),
    }),
  );
}

export async function deleteFinanceAction(f: FormData) {
  await runAsync("/financeiro", "Lançamento excluído.", (u) => deleteFinanceEntry(u, num(f, "id")));
}

// ───────────── chamada da equipe
export async function saveStaffAttendanceAction(f: FormData) {
  const cong = num(f, "congregation_id");
  const date = str(f, "date");
  const marks: Record<number, boolean> = {};
  for (const [k, val] of f.entries()) if (k.startsWith("p_")) marks[Number(k.slice(2))] = val === "1";
  await runAsync(`/colaboradores?d=${date}`, "Chamada da equipe salva.", (u) => saveStaffAttendance(u, cong, date, marks));
}
