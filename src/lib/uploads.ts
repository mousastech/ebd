/**
 * Arquivos enviados (fotos, logotipo, materiais). Ficam em data/uploads/<pasta>/ com nome aleatório;
 * o tipo é conferido pelos primeiros bytes (não pela extensão informada pelo navegador).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const UPLOAD_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EBD_UPLOAD_DIR ?? "data/uploads");

export type FileKind = "image" | "document";

const SIGNATURES: { ext: string; mime: string; kind: FileKind; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", mime: "image/jpeg", kind: "image", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", mime: "image/png", kind: "image", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", mime: "image/webp", kind: "image", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { ext: "pdf", mime: "application/pdf", kind: "document", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  // .pptx/.docx/.xlsx são ZIP; a extensão original decide qual
  { ext: "zip", mime: "application/zip", kind: "document", test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
];

const OFFICE: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", ...OFFICE,
};

export class UploadError extends Error {}

/** Valida e grava o arquivo; devolve o caminho relativo (ex.: "photos/3f…a1.jpg"). */
export async function saveUpload(
  file: File,
  folder: "photos" | "logo" | "library" | "mural",
  opts: { accept: FileKind[]; maxBytes: number },
): Promise<{ rel: string; mime: string; size: number; originalName: string }> {
  if (!file || file.size === 0) throw new UploadError("Selecione um arquivo.");
  if (file.size > opts.maxBytes) throw new UploadError(`Arquivo grande demais (máximo ${Math.round(opts.maxBytes / 1024 / 1024)} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig || !opts.accept.includes(sig.kind)) throw new UploadError("Tipo de arquivo não permitido.");
  let ext = sig.ext;
  let mime = sig.mime;
  if (ext === "zip") {
    const orig = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!OFFICE[orig]) throw new UploadError("Envie PDF, imagem ou arquivo do Office (pptx, docx, xlsx).");
    ext = orig;
    mime = OFFICE[orig];
  }
  const dir = path.join(/*turbopackIgnore: true*/ UPLOAD_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dir, name), buf);
  return { rel: `${folder}/${name}`, mime, size: buf.length, originalName: file.name.slice(0, 200) };
}

/** Resolve um caminho relativo com segurança (sem sair da pasta de uploads). */
export function resolveUpload(rel: string): string | null {
  if (!/^(photos|logo|library|mural)\/[a-f0-9]{24}\.(jpg|png|webp|pdf|pptx|docx|xlsx)$/.test(rel)) return null;
  const full = path.join(/*turbopackIgnore: true*/ UPLOAD_ROOT, rel);
  return fs.existsSync(full) ? full : null;
}

export function removeUpload(rel: string | null | undefined): void {
  const full = rel ? resolveUpload(rel) : null;
  if (full) fs.rmSync(full, { force: true });
}
