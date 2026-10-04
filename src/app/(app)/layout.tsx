import { logoutAction } from "@/app/actions";
import { NAV, ROLE_LABEL, can, canSeeSomething } from "@/lib/abac";
import { congregationName, listCongregations, sedeId } from "@/lib/church";
import Link from "next/link";
import { unreadCount } from "@/lib/notify";
import { requireUser } from "@/lib/auth";
import { BottomBar, NavLinks } from "@/components/NavLinks";
import { OfflineSync } from "@/components/OfflineSync";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const congs = listCongregations(user);
  const multi = congs.length > 1;
  const sede = sedeId();
  const items = NAV.filter((n) => n.href === "/" || canSeeSomething(user, n.type, n.action))
    .filter((n) => n.href !== "/congregacoes" || multi || user.role === "pastor")
    .filter((n) => n.href !== "/configuracoes" || can(user, "update", { type: "settings", congregationId: sede }))
    .map(({ href, label }) => ({ href, label }));
  const congLabel = user.view != null ? congregationName(user.view) : multi ? "Todas as congregações" : congs[0]?.name ?? null;
  const unread = unreadCount(user);
  const initials = user.name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          EBD
          <small>Escola Bíblica Dominical</small>
        </div>
        {congLabel && (multi ? <Link href="/congregacoes" className="congbar" title="Trocar congregação">{congLabel} <span aria-hidden="true">⇄</span></Link> : <span className="congbar">{congLabel}</span>)}
        <NavLinks items={items} />
        <div className="me">
          <Link href="/notificacoes" className="bell side-bell"><svg className="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg> Notificações{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}</Link>
          <strong>{user.name}</strong>
          {ROLE_LABEL[user.role]}
          <form action={logoutAction}>
            <button type="submit" className="small">Sair</button>
          </form>
        </div>
      </aside>
      <header className="appbar">
        <span className="appbar-left">
          <span className="brand">EBD</span>
          {congLabel && multi && <Link href="/congregacoes" className="congbar">{congLabel} <span aria-hidden="true">⇄</span></Link>}
        </span>
        <span className="appbar-me">
          <Link href="/notificacoes" className="bell" aria-label={`Notificações${unread ? ` (${unread} novas)` : ""}`} ><svg className="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}</Link><span className="small">{ROLE_LABEL[user.role]}</span>{user.photo ? <img src={`/arquivos/${user.photo}`} alt={user.name} className="avatar" /> : <span className="avatar" aria-label={user.name}>{initials}</span>}</span>
      </header>
      <main className="main"><OfflineSync userId={user.userId} />{children}</main>
      <BottomBar items={items} userName={user.name} roleLabel={ROLE_LABEL[user.role]} logout={logoutAction} />
    </div>
  );
}
