import Link from "next/link";
import { ROLE_LABEL } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { brl, fmtDay, fmtDate } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { attendanceDates, attendanceDay, dashboard } from "@/lib/repo";
import { Hero } from "@/components/app-ui";
import { listAnnouncements } from "@/lib/announcements";
import { listEvents } from "@/lib/agenda";
import { studentPortal } from "@/lib/portal";
import { quarterKey, quarterLabel } from "@/lib/format";
import { Empty, FlashMessage } from "@/components/ui";

export default async function Home({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const d = guarded(() => dashboard(user));
  const lastSunday = user.role === "aluno" ? undefined : attendanceDates(user, undefined, 1)[0];
  const day = lastSunday ? attendanceDay(user, lastSunday) : null;
  const news = listAnnouncements(user).filter((a) => !a.read || a.pinned).slice(0, 3);
  const nextEvents = listEvents(user).slice(0, 2);
  const portal = studentPortal(user);

  return (
    <>
      <h1>Olá, {user.name.split(" ")[0]}</h1>
      <p className="muted">Você está conectado como {ROLE_LABEL[user.role]}.</p>
      <FlashMessage flash={flash} />

      {day && day.cards.length > 0 && (
        <Link href={`/presenca?d=${day.date}`} style={{ textDecoration: "none" }}>
          <Hero
            eyebrow={`Último domingo · ${fmtDay(day.date)}`}
            value={day.pct === null ? "—" : `${day.pct}%`}
            caption="presença geral"
            stats={[
              { label: "Presentes", value: `${day.presentes}/${day.matriculados}` },
              { label: "Visitantes", value: day.visitantes },
              { label: "Oferta", value: brl(day.ofertaCents) },
            ]}
          />
        </Link>
      )}

      {portal && (
        <>
          <h2>Minha EBD</h2>
          {portal.classes.map((c) => (
            <section key={c.classId} className="hero">
              <div className="hero-eyebrow">{c.name} · {quarterLabel(portal.quarter)}</div>
              <div className="hero-main"><span className="hero-value">{c.pontos}</span><span className="hero-caption">pontos{c.pos ? ` · ${c.pos}º de ${c.turma} na turma` : ""}</span></div>
              <div className="hero-stats">
                <div><strong>{c.pct ?? "—"}{c.pct !== null ? "%" : ""}</strong><span>Presença</span></div>
                <div><strong>{c.presentes}/{c.total}</strong><span>Aulas</span></div>
                <div><strong>{c.badges.length}</strong><span>Medalhas</span></div>
              </div>
              {c.badges.length > 0 && <div className="badges">{c.badges.map((b) => <span key={b}>{b}</span>)}</div>}
            </section>
          ))}
          <div className="grid">
            {portal.classes.filter((c) => c.next).map((c) => (
              <div key={c.classId} className="card">
                <div className="muted small">📖 Próxima aula · {fmtDay(c.next!.date)}</div>
                <strong>{c.next!.topic ?? "Lição a definir"}</strong>
                <div className="small muted">{c.name}{c.next!.teacher ? ` · Prof. ${c.next!.teacher}` : ""}{c.next!.reading ? ` · Leitura: ${c.next!.reading}` : ""}</div>
                {c.next!.golden_text && <div className="small"><em>Texto áureo:</em> {c.next!.golden_text}</div>}
              </div>
            ))}
            {portal.pendingQuizzes.length > 0 && (
              <Link href={`/quiz/${portal.pendingQuizzes[0].id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="muted small">🧠 Quiz para responder</div>
                {portal.pendingQuizzes.slice(0, 3).map((z) => <div key={z.id}><strong>{z.title}</strong></div>)}
                <div className="small">Ganhe {5} pontos por acerto →</div>
              </Link>
            )}
            {portal.certificates.length > 0 && (
              <Link href={`/certificados?t=${quarterKey(portal.prevQuarter)}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="muted small">🎓 Certificado disponível</div>
                <strong>{quarterLabel(portal.prevQuarter)}</strong>
                <div className="small">Toque para imprimir</div>
              </Link>
            )}
            {portal.loans.length > 0 && (
              <Link href="/biblioteca" className="card" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="muted small">📚 Livros com você</div>
                {portal.loans.map((l) => <div key={l.id}>{l.title} <span className={`small ${l.late ? "neg" : "muted"}`}>até {l.due_at.split("-").reverse().join("/")}</span></div>)}
              </Link>
            )}
          </div>
        </>
      )}

      <div className="grid">
        {(d.toValidate ?? 0) > 0 && (
          <div className="card">
            <div className="muted small">Relatórios aguardando validação</div>
            <div className="stat">{d.toValidate}</div>
            <p className="small" style={{ marginTop: ".5rem" }}><Link href="/validacao">Validar →</Link></p>
          </div>
        )}
        {d.toFillCount > 0 && (
          <div className="card">
            <div className="muted small">Relatórios para preencher / enviar</div>
            <div className="stat">{d.toFillCount}</div>
            <ul className="small" style={{ margin: ".4rem 0 0", paddingLeft: "1.1rem" }}>
              {d.toFill.map((l) => (
                <li key={l.id}><Link href={`/presenca/${l.id}`}>{fmtDay(l.date)} — {l.class_name}</Link></li>
              ))}
            </ul>
          </div>
        )}
        {d.finance && (
          <div className="card">
            <div className="muted small">Revistas com saldo em aberto</div>
            <div className="stat">{d.finance.pendingCount}</div>
            <div className="muted">{brl(d.finance.pendingCents)} a receber</div>
            <p className="small" style={{ marginTop: ".5rem" }}>
              <Link href="/materiais">Ver material didático →</Link>
            </p>
          </div>
        )}

        {d.mine && (
          <div className="card">
            <div className="muted small">Minha presença (últimas aulas)</div>
            <div className="stat">
              {d.mine.presentes}/{d.mine.total}
            </div>
            <div className="bar" aria-hidden>
              <span style={{ width: `${d.mine.total ? (d.mine.presentes / d.mine.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {d.myOrders.map((o) => (
          <div className="card" key={o.id}>
            <div className="muted small">Minha revista</div>
            <strong>{o.material_title}</strong>
            <div>
              {o.balance_cents === 0 ? (
                <span className="badge ok">Quitada</span>
              ) : (
                <span className="badge warn">Falta {brl(o.balance_cents)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {(news.length > 0 || nextEvents.length > 0) && (
        <div className="grid">
          {news.length > 0 && (
            <Link href="/comunicados" className="card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="muted small">📢 Comunicados</div>
              {news.map((a) => <div key={a.id}><strong>{a.title}</strong>{!a.read && <span className="chip ok" style={{ marginLeft: 6 }}><i />novo</span>}</div>)}
            </Link>
          )}
          {nextEvents.length > 0 && (
            <Link href="/agenda" className="card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="muted small">📅 Próximos eventos</div>
              {nextEvents.map((e) => (
                <div key={e.id}><strong>{e.title}</strong> <span className="small muted">{e.starts_at.slice(8, 10)}/{e.starts_at.slice(5, 7)} às {e.starts_at.slice(11, 16)}{e.mine === "sim" ? " · ✓ você vai" : ""}</span></div>
              ))}
            </Link>
          )}
        </div>
      )}

      <h2>Próximas aulas</h2>
      <div className="card">
        {d.upcoming.length === 0 ? <Empty>Nenhuma aula escalada.</Empty> : (
          <div className="lessons">
            {d.upcoming.map((l) => (
              <div key={l.id} className="lesson-row" style={{ cursor: "default" }}>
                <span className="num" style={{ width: "3rem", fontSize: ".75rem" }}>{l.date.slice(8)}/{l.date.slice(5, 7)}</span>
                <span className="grow">
                  <strong>{l.class_name}</strong>
                  <small className="muted">
                    {l.kind === "evento" ? l.event_label : `${l.teacher_name ?? "Sem professor"}${l.topic ? ` · ${l.topic}` : ""}`}
                  </small>
                </span>
                {l.kind === "aula" && !l.teacher_name && <span className="chip bad"><i />sem prof.</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <h2>Aniversariantes nos próximos 7 dias</h2>
      <div className="card">
        {d.birthdays.length === 0 ? (
          <Empty>Ninguém faz aniversário nesta semana.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {d.birthdays.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong> — {fmtDate(`2000-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`).slice(0, 5)}
                {b.isToday && <span className="badge ok" style={{ marginLeft: ".5rem" }}>hoje 🎉</span>}
                <span className="muted"> ({b.classes.join(", ")})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
