/** Utilitários das server actions: lê o formulário e volta à página com mensagem de sucesso ou erro. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "./abac";
import { requireUser, type SessionUser } from "./auth";
import { UserError } from "./repo";
import { UploadError } from "./uploads";

export const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string): number => Number(f.get(k));
export const file = (f: FormData, k: string): File | null => {
  const v = f.get(k);
  return v instanceof File && v.size > 0 ? v : null;
};

export function withMsg(url: string, key: "ok" | "erro", msg: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
}

/** Executa uma operação autorizada (pode ser assíncrona); erros esperados voltam para a página com mensagem. */
export async function runAsync(
  back: string,
  okMsg: string,
  fn: (u: SessionUser) => void | Promise<void>,
  next: string = back,
): Promise<never> {
  const u = await requireUser();
  try {
    await fn(u);
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError || e instanceof UploadError)
      redirect(withMsg(back, "erro", e.message));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(withMsg(next, "ok", okMsg));
}
