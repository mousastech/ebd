import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { brl, fmtDate, fmtDay, isISODate } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { attendanceDates, attendanceDay, listAttendanceLessons, myAttendance } from "@/lib/repo";
import { Hero, LessonChip, Progress, pctTone } from "@/components/app-ui";
import { PrepareOffline } from "@/components/OfflineSync";
import { Empty, FlashMessage } from "@/components/ui";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Flash & { d?: string }> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const lessons = guarded(() => listAttendanceLessons(user));
  const mine = user.role === "aluno" && lessons.length === 0 ? myAttendance(user) : null;
  const dates = mine ? [] : attendanceDates(user);
  const selected = flash.d && isISODate(flash.d) ? flash.d : dates[0];
  const day = !mine && selected ? attendanceDay(user, selected) : null;
  // aulas de outros domingos que o usuário ainda precisa lançar ou corrigir
  const others = lessons.filter((l) => l.date !== selected && l.canFill && (!l.recorded || l.report_status === "devolvida")).slice(0, 8);

  return (
    <>
      <div className="row between">
        <h1>Presença</h1>
        <Link className="btn ghost small" href="/presenca/folha">Lista de chamada para imprimir</Link>
      </div>
      <FlashMessage flash={flash} />

      {mine && (
        <div className="card table-wrap">
          <h2 style={{ marginTop: 0 }}>Minha presença</h2>
          {mine.rows.length === 0 ? <Empty>Sem registros validados ainda.</Empty> : (
            <table>
              <thead><tr><th>Data</th><th>Classe</th><th>Situação</th></tr></thead>
              <tbody>
                {mine.rows.map((r) => (
                  <tr key={r.date + r.class_name}>
                    <td>{fmtDay(r.date)}</td>
                    <td>{r.class_name}</td>
                    <td>{r.present ? <span className="badge ok">Presente</span> : <span className="badge bad">Faltou</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!mine && day && (
        <>
          <nav className="chips" aria-label="Domingos">
            {dates.map((d) => (
              <Link key={d} href={`/presenca?d=${d}`} className={d === day.date ? "active" : ""}>{fmtDate(d).slice(0, 5)}</Link>
            ))}
          </nav>

          <Hero
            eyebrow={fmtDay(day.date)}
            value={day.pct === null ? "—" : `${day.pct}%`}
            caption="presença geral"
            stats={[
              { label: "Presentes", value: `${day.presentes}/${day.matriculados}` },
              { label: "Visitantes", value: day.visitantes },
              { label: "Oferta", value: brl(day.ofertaCents) },
            ]}
          />
          <p className="muted small">
            Chamada e oferta são lançadas pelo <strong>secretário da sala</strong>; o professor escalado assume só na ausência dele.
            {" "}{day.lancadas}/{day.cards.length} turmas lançadas.
          </p>

          <div className="row between">
            <h3 className="section-label" style={{ margin: 0 }}>Turmas</h3>
            <PrepareOffline urls={day.cards.filter((c) => c.canFill).map((c) => `/presenca/${c.id}`)} />
          </div>
          <div className="list">
            {day.cards.map((c) => {
              const pct = c.matriculados ? Math.round((c.presentes / c.matriculados) * 100) : null;
              return (
                <Link key={c.id} href={`/presenca/${c.id}`} className="list-card">
                  <div className="row between" style={{ flexWrap: "nowrap" }}>
                    <strong>{c.class_name}</strong>
                    <LessonChip recorded={c.recorded} status={c.report_status} />
                  </div>
                  <div className="small muted">{c.teacher_name ?? "Sem professor"}{c.canFill && !c.recorded && user.role !== "secretaria" && user.role !== "superintendente" ? " · toque para fazer a chamada" : ""}</div>
                  <div className="small"><strong>{c.presentes}</strong>/{c.matriculados} presentes{pct !== null && c.recorded ? ` · ${pct}%` : ""}</div>
                  <Progress value={c.presentes} max={c.matriculados} tone={c.recorded ? pctTone(pct) : "brand"} />
                </Link>
              );
            })}
          </div>

          {others.length > 0 && (
            <>
              <h3 className="section-label">Outros domingos aguardando você</h3>
              <div className="list">
                {others.map((l) => (
                  <Link key={l.id} href={`/presenca/${l.id}`} className="list-card">
                    <div className="row between" style={{ flexWrap: "nowrap" }}>
                      <strong>{l.class_name}</strong>
                      <LessonChip recorded={l.recorded} status={l.report_status} />
                    </div>
                    <div className="small muted">{fmtDay(l.date)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {!mine && !day && <Empty>Nenhuma aula disponível.</Empty>}
    </>
  );
}
