import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions-comunicacao";
import { requireUser } from "@/lib/auth";
import { listNotifications } from "@/lib/notify";
import { EnablePush } from "@/components/EnablePush";
import { Empty } from "@/components/ui";

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = listNotifications(user);
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <>
      <div className="row between">
        <div className="pagehead"><div><h1>Notificações</h1><p className="muted small">{unread ? `${unread} não lida(s)` : "Tudo em dia"}</p></div></div>
        {unread > 0 && <form action={markNotificationsReadAction}><button className="ghost small" type="submit">Marcar todas como lidas</button></form>}
      </div>
      <EnablePush />
      {items.length === 0 ? <Empty>Nenhuma notificação ainda.</Empty> : (
        <div className="list">
          {items.map((n) => {
            const body = (
              <>
                <div className="row between" style={{ flexWrap: "nowrap" }}>
                  <strong>{n.title}</strong>
                  {!n.read_at && <span className="chip brand"><i />nova</span>}
                </div>
                {n.body && <div className="small">{n.body}</div>}
                <div className="small muted">{when(n.created_at)}</div>
              </>
            );
            return n.url ? <Link key={n.id} href={n.url} className="list-card">{body}</Link> : <div key={n.id} className="list-card">{body}</div>;
          })}
        </div>
      )}
    </>
  );
}
