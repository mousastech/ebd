import { eventForIcs, eventsIcs } from "@/lib/agenda";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response("Não autenticado.", { status: 401 });
  const e = eventForIcs(u, Number((await params).id));
  if (!e) return new Response("Evento não encontrado.", { status: 404 });
  return new Response(eventsIcs([e], e.title), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="evento-${e.id}.ics"` },
  });
}
