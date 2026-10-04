/** Regras de leitura dos arquivos enviados, por pasta. Cada módulo registra a sua verificação aqui. */
import type { Subject } from "./abac";
import { canReadLibraryFile } from "./library";
import { canReadMuralImage } from "./mural";

type Check = (u: Subject, rel: string) => boolean;
const checks: Record<string, Check> = {
  photos: () => true, // fotos de perfil: qualquer usuário logado
  mural: canReadMuralImage,
  library: canReadLibraryFile,
};

export function registerUploadCheck(folder: string, fn: Check) {
  checks[folder] = fn;
}

export function canReadUpload(u: Subject, rel: string): boolean {
  const folder = rel.split("/")[0];
  const fn = checks[folder];
  return fn ? fn(u, rel) : false;
}
