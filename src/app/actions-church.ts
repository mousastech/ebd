"use server";

import { redirect } from "next/navigation";
import { file, num, runAsync, str } from "@/lib/action-run";
import { requireUser, setViewCongregation } from "@/lib/auth";
import { manualBackup } from "@/lib/backup";
import * as church from "@/lib/church";
import { UserError } from "@/lib/repo";
import { removeUpload, saveUpload } from "@/lib/uploads";

// ───────────── congregações
export async function switchCongregationAction(f: FormData) {
  const u = await requireUser();
  const id = num(f, "congregation_id");
  const reach = (x: number) => u.congregations == null || u.congregations.includes(x);
  await setViewCongregation(id > 0 && reach(id) ? id : null);
  redirect(str(f, "next") || "/");
}

export async function createCongregationAction(f: FormData) {
  await runAsync("/congregacoes", "Congregação criada.", (u) =>
    void church.createCongregation(u, { name: str(f, "name"), region: str(f, "region"), address: str(f, "address") }),
  );
}

export async function updateCongregationAction(f: FormData) {
  await runAsync("/congregacoes", "Congregação atualizada.", (u) =>
    church.updateCongregation(u, num(f, "id"), { name: str(f, "name"), region: str(f, "region"), address: str(f, "address") }),
  );
}

export async function setSupervisorCongregationsAction(f: FormData) {
  await runAsync("/congregacoes", "Região do supervisor atualizada.", (u) =>
    church.setSupervisorCongregations(u, num(f, "user_id"), f.getAll("congregation_id").map(Number).filter(Number.isInteger)),
  );
}

export async function setPersonCongregationAction(f: FormData) {
  const personId = num(f, "person_id");
  await runAsync(`/pessoas/${personId}`, "Congregação alterada.", (u) =>
    church.setPersonCongregation(u, personId, num(f, "congregation_id")),
  );
}

// ───────────── dados da igreja
export async function saveSettingsAction(f: FormData) {
  await runAsync("/configuracoes", "Dados da igreja salvos.", (u) =>
    church.saveSettings(u, {
      church_name: str(f, "church_name"), church_short: str(f, "church_short"), president: str(f, "president"),
      address: str(f, "address"), city: str(f, "city"), cnpj: str(f, "cnpj"), lema: str(f, "lema"),
    }),
  );
}

export async function uploadLogoAction(f: FormData) {
  await runAsync("/configuracoes", "Logotipo atualizado.", async (u) => {
    const img = file(f, "logo");
    if (!img) throw new UserError("Selecione uma imagem.");
    const saved = await saveUpload(img, "logo", { accept: ["image"], maxBytes: 2 * 1024 * 1024 });
    try {
      church.setLogo(u, saved.rel);
    } catch (e) {
      removeUpload(saved.rel);
      throw e;
    }
  });
}

export async function removeLogoAction() {
  await runAsync("/configuracoes", "Logotipo removido.", (u) => church.setLogo(u, null));
}

// ───────────── foto de perfil
export async function uploadPhotoAction(f: FormData) {
  const personId = num(f, "person_id");
  const back = str(f, "back") || `/pessoas/${personId}`;
  await runAsync(back, "Foto atualizada.", async (u) => {
    const img = file(f, "photo");
    if (!img) throw new UserError("Selecione uma foto.");
    const saved = await saveUpload(img, "photos", { accept: ["image"], maxBytes: 4 * 1024 * 1024 });
    try {
      church.setPersonPhoto(u, personId, saved.rel);
    } catch (e) {
      removeUpload(saved.rel);
      throw e;
    }
  });
}

export async function removePhotoAction(f: FormData) {
  const personId = num(f, "person_id");
  await runAsync(str(f, "back") || `/pessoas/${personId}`, "Foto removida.", (u) => church.setPersonPhoto(u, personId, null));
}

// ───────────── backup
export async function backupNowAction() {
  await runAsync("/configuracoes", "Cópia de segurança criada.", async (u) => void (await manualBackup(u)));
}
