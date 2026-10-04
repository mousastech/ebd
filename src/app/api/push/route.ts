import { currentUser } from "@/lib/auth";
import { removePushSubscription, savePushSubscription, vapidKeys } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** GET: chave pública VAPID. POST: salva a inscrição de push deste aparelho. DELETE: remove. */
export async function GET() {
  return Response.json({ publicKey: vapidKeys().publicKey });
}

export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Não autenticado.", { status: 401 });
  try {
    savePushSubscription(u, await req.json());
    return Response.json({ ok: true });
  } catch {
    return new Response("Inscrição inválida.", { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Não autenticado.", { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) removePushSubscription(u, endpoint);
  return Response.json({ ok: true });
}
