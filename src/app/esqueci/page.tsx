import Link from "next/link";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/reset";

export const dynamic = "force-dynamic";

async function requestAction(f: FormData) {
  "use server";
  const email = String(f.get("email") ?? "");
  if (/^\S+@\S+\.\S+$/.test(email)) requestPasswordReset(email);
  redirect("/esqueci?enviado=1");
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ enviado?: string }> }) {
  const sent = (await searchParams).enviado === "1";
  return (
    <main className="login">
      <form action={requestAction} className="card stack">
        <div><h1>Esqueci minha senha</h1><p className="muted">A superintendência recebe o pedido e define uma nova senha para você.</p></div>
        {sent ? (
          <p className="flash ok" role="status">Pedido enviado. Se o e-mail estiver cadastrado, a superintendência vai falar com você.</p>
        ) : (
          <>
            <div><label htmlFor="email">E-mail cadastrado</label><input id="email" name="email" type="email" required autoFocus /></div>
            <button type="submit">Pedir nova senha</button>
          </>
        )}
        <Link href="/login" className="small" style={{ textAlign: "center" }}>← Voltar ao login</Link>
      </form>
    </main>
  );
}
