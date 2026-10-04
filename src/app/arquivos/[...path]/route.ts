import fs from "node:fs";
import { currentUser } from "@/lib/auth";
import { canReadUpload } from "@/lib/files";
import { MIME_BY_EXT, resolveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Entrega arquivos enviados. O logotipo é público (aparece no login e no app instalado);
 * fotos exigem login; materiais da biblioteca e do mural seguem as permissões do registro.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const full = resolveUpload(rel);
  if (!full) return new Response("Arquivo não encontrado.", { status: 404 });
  if (!rel.startsWith("logo/")) {
    const user = await currentUser();
    if (!user) return new Response("Não autenticado.", { status: 401 });
    if (!canReadUpload(user, rel)) return new Response("Sem permissão.", { status: 403 });
  }
  const ext = rel.split(".").pop()!;
  const body = fs.readFileSync(full);
  return new Response(body, {
    headers: {
      "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "cache-control": rel.startsWith("logo/") ? "public, max-age=86400" : "private, max-age=3600",
      "x-content-type-options": "nosniff",
      ...(ext === "pdf" || MIME_BY_EXT[ext]?.startsWith("image/") ? {} : { "content-disposition": "attachment" }),
    },
  });
}
