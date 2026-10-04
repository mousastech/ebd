"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { previewImport, runImport, type ImportRow } from "@/lib/importer";
import { UserError } from "@/lib/repo";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

async function safe<T>(fn: () => T): Promise<R<T>> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function previewImportAction(text: string): Promise<R<ImportRow[]>> {
  const u = await requireUser();
  if (text.length > 2_000_000) return { ok: false, error: "Arquivo grande demais." };
  return safe(() => previewImport(u, text));
}

export async function runImportAction(text: string): Promise<R<{ criados: number; matriculados: number; erros: number }>> {
  const u = await requireUser();
  const r = await safe(() => runImport(u, text));
  revalidatePath("/pessoas");
  return r;
}
