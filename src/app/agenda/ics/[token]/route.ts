import { feedForToken } from "@/lib/agenda";

export const dynamic = "force-dynamic";

/** Feed pessoal do calendário (assinatura no Google Agenda / iPhone). O token identifica o usuário. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ics = feedForToken(token.replace(/\.ics$/, ""));
  if (!ics) return new Response("Calendário não encontrado.", { status: 404 });
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900" } });
}
