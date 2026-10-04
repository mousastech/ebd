"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError, ROLES, type Role } from "@/lib/abac";
import { endSession, login, requireUser, startSession, type SessionUser } from "@/lib/auth";
import { parseMoney, parseQuarter, quarterKey } from "@/lib/format";
import type { ScheduleMode } from "@/lib/labels";
import * as repo from "@/lib/repo";
import { linkCurriculum } from "@/lib/teaching";

const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string): number => Number(f.get(k));

function withMsg(url: string, key: "ok" | "erro", msg: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
}

/** Executa uma operação autorizada; erros esperados voltam para a página com mensagem. */
async function run(
  back: string,
  okMsg: string,
  fn: (u: SessionUser) => void,
  next: string = back,
): Promise<never> {
  const u = await requireUser();
  try {
    fn(u);
  } catch (e) {
    if (e instanceof repo.UserError || e instanceof ForbiddenError) redirect(withMsg(back, "erro", e.message));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(withMsg(next, "ok", okMsg));
}

// ───────────── sessão
export async function loginAction(form: FormData): Promise<void> {
  const id = login(str(form, "email"), String(form.get("password") ?? ""));
  if (id === null) redirect(withMsg("/login", "erro", "E-mail ou senha inválidos."));
  await startSession(id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

// ───────────── classes, escalas (grupos) e equipe
export async function createClassAction(f: FormData) {
  await run("/classes", "Classe criada.", (u) =>
    void repo.createClass(u, str(f, "name"), str(f, "age_range"), num(f, "group_id") || null),
  );
}

export async function setGroupCoordinatorAction(f: FormData) {
  await run("/classes", "Coordenador da escala atualizado.", (u) =>
    repo.setGroupCoordinator(u, num(f, "group_id"), num(f, "person_id") || null),
  );
}

export async function createGroupAction(f: FormData) {
  await run("/classes", "Escala criada.", (u) => void repo.createGroup(u, str(f, "name"), num(f, "person_id") || null));
}

export async function setClassGroupAction(f: FormData) {
  const classId = num(f, "class_id");
  await run(`/classes/${classId}`, "Classe movida de escala.", (u) =>
    repo.setClassGroup(u, classId, num(f, "group_id") || null),
  );
}

export async function addStaffAction(f: FormData) {
  const classId = num(f, "class_id");
  await run(`/classes/${classId}`, "Equipe atualizada.", (u) =>
    repo.addStaff(u, classId, num(f, "person_id"), str(f, "function")),
  );
}

export async function removeStaffAction(f: FormData) {
  const classId = num(f, "class_id");
  await run(`/classes/${classId}`, "Removido da equipe.", (u) =>
    repo.removeStaff(u, classId, num(f, "person_id"), str(f, "function")),
  );
}

export async function enrollAction(f: FormData) {
  const classId = num(f, "class_id");
  await run(`/classes/${classId}`, "Aluno matriculado.", (u) => repo.enrollStudent(u, classId, num(f, "person_id")));
}

export async function unenrollAction(f: FormData) {
  const classId = num(f, "class_id");
  await run(`/classes/${classId}`, "Matrícula removida.", (u) => repo.unenrollStudent(u, classId, num(f, "person_id")));
}

// ───────────── pessoas
export async function createPersonAction(f: FormData) {
  const classId = num(f, "class_id") || undefined;
  await run("/pessoas", "Pessoa cadastrada.", (u) =>
    void repo.createPerson(u, {
      name: str(f, "name"),
      birth_date: str(f, "birth_date"),
      phone: str(f, "phone"),
      guardian_name: str(f, "guardian_name"),
      classId,
    }),
  );
}

export async function updatePersonAction(f: FormData) {
  await run("/pessoas", "Cadastro atualizado.", (u) =>
    repo.updatePerson(u, num(f, "id"), {
      name: str(f, "name"),
      birth_date: str(f, "birth_date"),
      phone: str(f, "phone"),
      guardian_name: str(f, "guardian_name"),
    }),
  );
}

// ───────────── presença
export async function saveAttendanceAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  // campos p_<id> = "1" (presente) | "0" (falta); quem ficou sem marcação conta como falta
  const present = [...f.entries()]
    .filter(([k, v]) => k.startsWith("p_") && v === "1")
    .map(([k]) => Number(k.slice(2)))
    .filter(Number.isInteger);
  const hasCounts = f.has("visitors") || f.has("offering");
  const offering = hasCounts ? parseMoney(str(f, "offering") || "0") : 0;
  await run(`/presenca/${lessonId}`, hasCounts ? "Presença, visitantes e oferta salvos." : "Presença salva.", (u) => {
    if (offering === null) throw new repo.UserError("Valor da oferta inválido (use 25,50).");
    const visitors = Number(str(f, "visitors") || 0);
    repo.saveAttendanceWithCounts(u, lessonId, present, hasCounts ? { visitors, offering_cents: offering } : null);
  }, "/presenca");
}

// ───────────── envio, substituição e validação do relatório
export async function submitReportAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  await run(`/presenca/${lessonId}`, "Relatório enviado para validação da secretaria geral.", (u) =>
    repo.submitReport(u, lessonId), "/presenca");
}

export async function setAbsentAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  const absent = str(f, "absent") === "1";
  await run(`/presenca/${lessonId}`, absent ? "Secretário marcado como ausente: o professor escalado pode preencher." : "Secretário volta a preencher.", (u) =>
    repo.setSecretaryAbsent(u, lessonId, absent));
}

export async function validateReportAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  await run(`/validacao/${lessonId}`, "Relatório validado.", (u) => repo.validateReport(u, lessonId), "/validacao");
}

export async function returnReportAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  await run(`/validacao/${lessonId}`, "Relatório devolvido para correção.", (u) =>
    repo.returnReport(u, lessonId, str(f, "note")), "/validacao");
}

// ───────────── escala por trimestre
export async function generateScheduleAction(f: FormData) {
  const quarter = parseQuarter(str(f, "quarter"));
  const back = `/escala?t=${quarterKey(quarter)}`;
  await run(back, "Domingos do trimestre gerados.", (u) => {
    const modo = str(f, "modo");
    if (!["vazia", "rodizio", "remanejada"].includes(modo)) throw new repo.UserError("Escolha como gerar a escala.");
    const n = repo.generateQuarterSchedule(u, num(f, "class_id"), quarter, modo as ScheduleMode);
    if (n === 0) throw new repo.UserError("Todos os domingos deste trimestre já estão na escala.");
    linkCurriculum(num(f, "class_id"), quarter); // lições já cadastradas passam a valer para os novos domingos
  });
}

export async function saveScheduleAction(f: FormData) {
  const quarter = parseQuarter(str(f, "quarter"));
  const classId = num(f, "class_id");
  const entries = [...f.keys()]
    .filter((k) => k.startsWith("l_"))
    .map((k) => ({ lessonId: Number(k.slice(2)), value: String(f.get(k) ?? "") }));
  await run(`/escala?t=${quarterKey(quarter)}`, "Escala salva.", (u) => {
    repo.saveQuarterSchedule(u, classId, entries);
    linkCurriculum(classId, quarter); // um domingo virou "sem aula"? as lições se reorganizam
  });
}

// ───────────── diário
export async function saveDiaryAction(f: FormData) {
  const lessonId = num(f, "lesson_id");
  const offering = parseMoney(str(f, "offering") || "0");
  await run(`/diario/${lessonId}`, "Diário salvo.", (u) => {
    if (offering === null) throw new repo.UserError("Valor da oferta inválido (use 25,50).");
    repo.saveDiary(u, lessonId, {
      topic: str(f, "topic"),
      notes: str(f, "notes"),
      visitors: Math.trunc(Number(str(f, "visitors") || 0)),
      offering_cents: offering,
    });
  }, "/diario");
}

// ───────────── material didático
export async function createMaterialAction(f: FormData) {
  const price = parseMoney(str(f, "price"));
  await run("/materiais", "Revista cadastrada e pedidos gerados.", (u) => {
    if (price === null) throw new repo.UserError("Preço inválido (use 18,90).");
    repo.createMaterial(u, { title: str(f, "title"), period: str(f, "period"), priceCents: price, classId: num(f, "class_id") });
  });
}

export async function registerPaymentAction(f: FormData) {
  const amount = parseMoney(str(f, "amount"));
  await run("/materiais", "Pagamento registrado.", (u) => {
    if (amount === null) throw new repo.UserError("Valor inválido (use 18,90).");
    repo.registerPayment(u, num(f, "order_id"), amount, str(f, "method"), str(f, "date"));
  });
}

// ───────────── usuários
export async function createUserAction(f: FormData) {
  const role = str(f, "role") as Role;
  await run("/usuarios", "Usuário criado.", (u) => {
    if (!ROLES.includes(role)) throw new repo.UserError("Função inválida.");
    repo.createUser(u, { personId: num(f, "person_id"), email: str(f, "email"), password: String(f.get("password") ?? ""), role });
  });
}

export async function changeRoleAction(f: FormData) {
  const role = str(f, "role") as Role;
  await run("/usuarios", "Função alterada.", (u) => {
    if (!ROLES.includes(role)) throw new repo.UserError("Função inválida.");
    repo.changeUserRole(u, num(f, "user_id"), role);
  });
}

export async function resetPasswordAction(f: FormData) {
  await run("/usuarios", "Senha redefinida. Informe a nova senha à pessoa.", (u) =>
    repo.resetUserPassword(u, num(f, "user_id"), String(f.get("password") ?? "")),
  );
}
