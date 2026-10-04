import Link from "next/link";
import { headers } from "next/headers";
import { createEventAction, deleteEventAction, rotateCalendarTokenAction, rsvpAction } from "@/app/actions-comunicacao";
import { calendarToken, eventAttendees, googleCalendarUrl, listEvents } from "@/lib/agenda";
import { audienceOptions } from "@/lib/announcements";
import { requireUser } from "@/lib/auth";
import { type Flash } from "@/lib/guard";
import { Empty, FlashMessage } from "@/components/ui";

const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const parts = (local: string) => {
  const d = new Date(`${local}:00Z`);
  return { wd: WD[d.getUTCDay()], day: local.slice(8, 10), mon: MO[Number(local.slice(5, 7)) - 1], time: local.slice(11, 16) };
};

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Flash & { passados?: string; ver?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const past = sp.passados === "1";
  const events = listEvents(user, { past });
  const options = audienceOptions(user, "event");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const feed = `${origin}/agenda/ics/${calendarToken(user)}.ics`;
  const showId = Number(sp.ver) || null;

  return (
    <>
      <div className="pagehead"><div><h1>Agenda</h1><p className="muted small">Eventos da EBD e confirmação de presença.</p></div></div>
      <FlashMessage flash={sp} />
      <nav className="chips">
        <Link href="/agenda" className={!past ? "active" : ""}>Próximos</Link>
        <Link href="/agenda?passados=1" className={past ? "active" : ""}>Passados</Link>
      </nav>

      {options.length > 0 && !past && (
        <details className="card">
          <summary><strong>＋ Novo evento</strong></summary>
          <form action={createEventAction} className="stack" style={{ marginTop: ".7rem" }}>
            <div className="form-grid">
              <div><label htmlFor="et">Título</label><input id="et" name="title" required maxLength={120} placeholder="ex.: Confraternização da EBD" /></div>
              <div><label htmlFor="es">Início</label><input id="es" name="starts_at" type="datetime-local" required /></div>
              <div><label htmlFor="ee">Término (opcional)</label><input id="ee" name="ends_at" type="datetime-local" /></div>
              <div><label htmlFor="el">Local</label><input id="el" name="location" /></div>
              <div>
                <label htmlFor="ea">Para quem</label>
                <select id="ea" name="audience">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </div>
            </div>
            <div><label htmlFor="ed">Descrição</label><textarea id="ed" name="description" /></div>
            <div className="row">
              <label className="check"><input type="checkbox" name="rsvp" defaultChecked /> Pedir confirmação de presença</label>
              <label className="check"><input type="checkbox" name="notify" defaultChecked /> Avisar no celular</label>
              {user.role === "pastor" && <label className="check"><input type="checkbox" name="all" /> Todas as congregações</label>}
            </div>
            <button type="submit">Criar evento</button>
          </form>
        </details>
      )}

      {events.length === 0 ? <Empty>{past ? "Nenhum evento passado." : "Nenhum evento agendado."}</Empty> : (
        <div className="list" style={{ gridTemplateColumns: "1fr" }}>
          {events.map((e) => {
            const p = parts(e.starts_at);
            const who = e.canEdit && showId === e.id ? eventAttendees(user, e.id) : null;
            return (
              <article key={e.id} className="list-card event">
                <div className="event-date" aria-hidden="true"><small>{p.wd}</small><strong>{p.day}</strong><small>{p.mon}</small></div>
                <div className="event-info">
                  <h3 style={{ margin: 0 }}>{e.title}</h3>
                  <div className="small muted">
                    {p.time}{e.ends_at ? `–${e.ends_at.slice(11, 16)}` : ""}{e.location ? ` · ${e.location}` : ""} · para: {e.audienceLabel}
                  </div>
                  {e.description && <p className="small announce-body">{e.description}</p>}
                  {e.rsvp ? (
                    <div className="rsvp">
                      {!past && (["sim", "talvez", "nao"] as const).map((a) => (
                        <form key={a} action={rsvpAction}>
                          <input type="hidden" name="event_id" value={e.id} />
                          <input type="hidden" name="answer" value={a} />
                          <button type="submit" className={`small ${e.mine === a ? "" : "ghost"}`}>{a === "sim" ? "✓ Vou" : a === "talvez" ? "Talvez" : "Não vou"}</button>
                        </form>
                      ))}
                      <span className="small muted">{e.counts.sim} confirmado(s){e.counts.guests ? ` + ${e.counts.guests} convidado(s)` : ""} · {e.counts.talvez} talvez</span>
                    </div>
                  ) : null}
                  <div className="row small" style={{ marginTop: ".4rem" }}>
                    <a href={googleCalendarUrl(e)} target="_blank" rel="noopener noreferrer">＋ Google Agenda</a>
                    <a href={`/agenda/${e.id}/ics`}>Baixar .ics</a>
                    {e.canEdit && e.rsvp ? <Link href={showId === e.id ? "/agenda" : `/agenda?ver=${e.id}`}>{showId === e.id ? "Ocultar lista" : "Ver confirmados"}</Link> : null}
                    {e.canEdit && (
                      <form action={deleteEventAction}><input type="hidden" name="id" value={e.id} /><button className="danger small" type="submit">Excluir</button></form>
                    )}
                  </div>
                  {who && (
                    <ul className="small" style={{ margin: ".4rem 0 0", paddingLeft: "1.1rem" }}>
                      {who.length === 0 ? <li className="muted">Ninguém respondeu ainda.</li> : who.map((w) => (
                        <li key={w.name}>{w.name} — {w.answer === "sim" ? `vai${w.guests ? ` (+${w.guests})` : ""}` : w.answer === "talvez" ? "talvez" : "não vai"}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <details className="card">
        <summary><strong>📆 Assinar a agenda no Google Agenda ou no iPhone</strong></summary>
        <p className="small" style={{ marginTop: ".6rem" }}>
          Copie o endereço abaixo. No Google Agenda (computador): <em>Outras agendas → ＋ → Do URL</em>. No iPhone:
          <em> Ajustes → Calendário → Contas → Adicionar conta → Outra → Adicionar calendário assinado</em>.
          Os eventos da EBD passam a aparecer e se atualizam sozinhos.
        </p>
        <input readOnly value={feed} aria-label="Endereço da agenda" />
        <form action={rotateCalendarTokenAction} style={{ marginTop: ".5rem" }}>
          <button className="ghost small" type="submit">Gerar novo endereço (invalida o atual)</button>
        </form>
      </details>
    </>
  );
}
