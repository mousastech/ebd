import fs from "node:fs";
import { ForbiddenError } from "@/lib/abac";
import { currentUser } from "@/lib/auth";
import { backupPath } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Não autenticado.", { status: 401 });
  const { name } = await params;
  try {
    const full = backupPath(user, name);
    if (!full) return new Response("Cópia não encontrada.", { status: 404 });
    return new Response(fs.readFileSync(full), {
      headers: { "content-type": "application/vnd.sqlite3", "content-disposition": `attachment; filename="${name}"` },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
