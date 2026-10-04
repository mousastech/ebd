import { ForbiddenError } from "@/lib/abac";
import { currentUser } from "@/lib/auth";
import { parseMoney } from "@/lib/format";
import { saveAttendanceWithCounts, UserError } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Recebe uma chamada feita SEM INTERNET (guardada no aparelho) quando a conexão volta.
 * Aplica exatamente as mesmas regras da tela: permissões, aula editável, roster decidido no servidor.
 */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Faça login novamente para enviar a chamada guardada." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { lessonId?: number; present?: number[]; visitors?: string | number; offering?: string } | null;
  if (!body || !Number.isInteger(body.lessonId) || !Array.isArray(body.present)) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const hasCounts = body.visitors !== undefined || body.offering !== undefined;
  const offering = hasCounts ? parseMoney(String(body.offering ?? "0") || "0") : 0;
  try {
    if (offering === null) throw new UserError("Valor da oferta inválido.");
    saveAttendanceWithCounts(u, body.lessonId!, body.present.map(Number).filter(Number.isInteger),
      hasCounts ? { visitors: Number(body.visitors ?? 0), offering_cents: offering } : null);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
