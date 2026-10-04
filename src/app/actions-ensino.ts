"use server";

import { redirect } from "next/navigation";
import { file, num, runAsync, str, withMsg } from "@/lib/action-run";
import { requireUser } from "@/lib/auth";
import { parseQuarter, quarterKey } from "@/lib/format";
import * as lib from "@/lib/library";
import * as quiz from "@/lib/quiz";
import { UserError } from "@/lib/repo";
import * as teach from "@/lib/teaching";
import { removeUpload, saveUpload, UploadError } from "@/lib/uploads";
import { ForbiddenError } from "@/lib/abac";
import { revalidatePath } from "next/cache";

// ───────────── lições e planos
export async function saveCurriculumAction(f: FormData) {
  const classId = num(f, "class_id");
  const q = parseQuarter(str(f, "quarter"));
  const back = `/licoes?classe=${classId}&t=${quarterKey(q)}`;
  await runAsync(back, "Lições salvas e ligadas aos domingos.", (u) => void teach.saveCurriculum(u, classId, q, String(f.get("text") ?? "")));
}

export async function savePlanAction(f: FormData) {
  const back = str(f, "back") || "/licoes?aba=planos";
  await runAsync(back, "Plano de aula salvo.", (u) => teach.savePlan(u, num(f, "lesson_id"), String(f.get("plan") ?? "")));
}

// ───────────── quiz
export async function createQuizAction(f: FormData) {
  const questions: { text: string; options: string[]; correct: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const text = str(f, `q${i}`);
    if (!text) continue;
    questions.push({ text, options: [1, 2, 3, 4].map((k) => str(f, `q${i}o${k}`)), correct: num(f, `q${i}c`) - 1 });
  }
  await runAsync("/quiz", "Quiz publicado para a classe.", (u) =>
    void quiz.createQuiz(u, { classId: num(f, "class_id"), title: str(f, "title"), openUntil: str(f, "open_until"), questions }),
  );
}

export async function deleteQuizAction(f: FormData) {
  await runAsync("/quiz", "Quiz excluído.", (u) => quiz.deleteQuiz(u, num(f, "id")));
}

export async function answerQuizAction(f: FormData) {
  const id = num(f, "id");
  const u = await requireUser();
  const answers: number[] = [];
  for (let i = 1; i <= 20; i++) answers.push(f.has(`a${i}`) ? num(f, `a${i}`) : -1);
  let msg: string;
  try {
    const r = quiz.answerQuiz(u, id, answers);
    msg = `Você acertou ${r.score} de ${r.total}! +${r.score * quiz.POINTS.acerto} pontos.`;
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError) redirect(withMsg(`/quiz/${id}`, "erro", e.message));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(withMsg(`/quiz/${id}`, "ok", msg));
}

// ───────────── biblioteca
export async function createLibraryItemAction(f: FormData) {
  await runAsync("/biblioteca", "Item adicionado à biblioteca.", async (u) => {
    const kind = str(f, "kind");
    const up = kind === "arquivo" ? file(f, "file") : null;
    if (kind === "arquivo" && !up) throw new UploadError("Escolha o arquivo.");
    const saved = up ? await saveUpload(up, "library", { accept: ["document", "image"], maxBytes: 10 * 1024 * 1024 }) : null;
    try {
      lib.createLibraryItem(u, {
        kind, title: str(f, "title"), description: str(f, "description"), author: str(f, "author"), url: str(f, "url"),
        copies: num(f, "copies"), audience: str(f, "audience"), classId: num(f, "class_id") || null, file: saved,
      });
    } catch (e) {
      removeUpload(saved?.rel);
      throw e;
    }
  });
}

export async function deleteLibraryItemAction(f: FormData) {
  await runAsync("/biblioteca", "Item removido.", (u) => lib.deleteLibraryItem(u, num(f, "id")));
}

export async function lendAction(f: FormData) {
  await runAsync("/biblioteca?aba=emprestimos", "Empréstimo registrado.", (u) => void lib.lendItem(u, num(f, "item_id"), num(f, "person_id"), str(f, "due_at")));
}

export async function returnLoanAction(f: FormData) {
  await runAsync("/biblioteca?aba=emprestimos", "Devolução registrada.", (u) => lib.returnLoan(u, num(f, "id")));
}
