import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { getSettings } from "@/lib/church";
import type { Flash } from "@/lib/guard";
import { FlashMessage } from "@/components/ui";
import { ClearOfflinePages } from "@/components/OfflineSync";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Flash> }) {
  if (await currentUser()) redirect("/");
  const flash = await searchParams;
  const settings = getSettings();
  return (
    <main className="login">
      <ClearOfflinePages />
      <form action={loginAction} className="card stack">
        <div style={{ textAlign: "center" }}>
          {settings.logo ? <img src={`/arquivos/${settings.logo}`} alt="" style={{ width: 72, height: 72, objectFit: "contain" }} /> : <img src="/icons/icon-192.png" alt="" style={{ width: 64, borderRadius: 16 }} />}
          <h1 style={{ marginTop: ".4rem" }}>EBD</h1>
          <p className="muted">{settings.church_name}<br />Escola Bíblica Dominical</p>
        </div>
        <FlashMessage flash={flash} />
        <div>
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </div>
        <div>
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit">Entrar</button>
        {googleEnabled() && (
          <a className="btn ghost google" href="/auth/google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Entrar com Google
          </a>
        )}
        <a href="/esqueci" className="small" style={{ textAlign: "center" }}>Esqueci minha senha</a>
      </form>
    </main>
  );
}
