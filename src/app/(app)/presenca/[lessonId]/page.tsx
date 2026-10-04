import Link from "next/link";
import { saveAttendanceAction, setAbsentAction, submitReportAction } from "@/app/actions";
import { createVisitorAction } from "@/app/actions-gestao";
import { can } from "@/lib/abac";
import { visitorsOn } from "@/lib/visitors";
import { requireUser } from "@/lib/auth";
import { fmtDay } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { getAttendanceSheet } from "@/lib/repo";
import { RollCall } from "@/components/RollCall";
import { FlashMessage, ReportBadge } from "@/components/ui";

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<Flash>;
}) {
  const user = await requireUser();
  const { lessonId } = await params;
  const flash = await searchParams;
  const sheet = guarded(() => getAttendanceSheet(user, Number(lessonId)));
  const { lesson, people, recorded, canEdit, canEditCounts, canSubmit, canMarkAbsent, canUnmarkAbsent, hint } = sheet;
  const alunos = people.filter((p) => p.kind === "aluno");
  const professores = people.filter((p) => p.kind === "professor");

  const locked = !canEdit && lesson.kind === "aula";
  const canAddVisitor = lesson.kind === "aula" && can(user, "create", { type: "visitor", classIds: [lesson.class_id] });
  const visitorsToday = canAddVisitor ? visitorsOn(lesson.class_id, lesson.date) : [];
  const offering = (lesson.offering_cents / 100).toFixed(2).replace(".", ",");

  return (
    <>
      <div className="pagehead">
        <Link href="/presenca" className="back" aria-label="Voltar">←</Link>
        <div>
          <h1>Presença · {lesson.class_name}</h1>
          <p className="muted small">{fmtDay(lesson.date)}{lesson.topic ? ` · ${lesson.topic}` : ""} · <ReportBadge status={lesson.report_status} /></p>
        </div>
      </div>
      <FlashMessage flash={flash} />

      {lesson.report_status === "devolvida" && lesson.return_note && (
        <div className="note" role="alert"><strong>Devolvido pela secretaria geral:</strong> {lesson.return_note}</div>
      )}
      {locked ? (
        <div className="note">
          🔒 {lesson.report_status === "validada" ? "Aula validada — só a superintendência pode reabrir." :
            lesson.report_status === "enviada" ? "Relatório enviado — aguardando a validação da secretaria geral." : hint}
        </div>
      ) : (
        <div className="hint">{hint}</div>
      )}

      <form action={saveAttendanceAction}>
        <input type="hidden" name="lesson_id" value={lesson.id} />
        <RollCall
          teachers={professores}
          students={alunos}
          disabled={!canEdit}
          submitLabel={recorded ? "Atualizar presença" : "Salvar presença"}
          offline={{ userId: user.userId, lessonId: lesson.id, label: `${lesson.class_name} ${lesson.date.split("-").reverse().join("/")}` }}
          counts={canEditCounts || lesson.visitors || lesson.offering_cents
            ? { visitors: lesson.visitors, offering, editable: canEditCounts && canEdit }
            : null}
        />
      </form>

      {canAddVisitor && (
        <details className="card">
          <summary><strong>＋ Registrar visitante pelo nome</strong> <span className="muted small">para acompanhar e convidar de volta</span></summary>
          <form action={createVisitorAction} className="form-grid" style={{ marginTop: ".6rem" }}>
            <input type="hidden" name="class_id" value={lesson.class_id} />
            <input type="hidden" name="date" value={lesson.date} />
            <input type="hidden" name="back" value={`/presenca/${lesson.id}`} />
            <div><label htmlFor="vn">Nome</label><input id="vn" name="name" required /></div>
            <div><label htmlFor="vp">Telefone</label><input id="vp" name="phone" inputMode="tel" /></div>
            <div><label htmlFor="vi">Convidado por</label><input id="vi" name="invited_by" /></div>
            <button type="submit" className="small">Registrar</button>
          </form>
          {visitorsToday.length > 0 && <p className="small muted">Registrados nesta aula: {visitorsToday.join(", ")}</p>}
        </details>
      )}

      <h2>Relatório da aula</h2>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          A presença, os visitantes e a <strong>oferta</strong> (com o tema no diário) formam o relatório da aula.{" "}
          <Link href={`/diario/${lesson.id}`}>Tema e observações →</Link>
        </p>
        <div className="row">
          {canSubmit && (
            <form action={submitReportAction}>
              <input type="hidden" name="lesson_id" value={lesson.id} />
              <button type="submit">Enviar relatório para validação</button>
            </form>
          )}
          {canMarkAbsent && (
            <form action={setAbsentAction}>
              <input type="hidden" name="lesson_id" value={lesson.id} />
              <input type="hidden" name="absent" value="1" />
              <button type="submit" className="ghost">Secretário ausente — assumo o preenchimento</button>
            </form>
          )}
          {canUnmarkAbsent && (
            <form action={setAbsentAction}>
              <input type="hidden" name="lesson_id" value={lesson.id} />
              <input type="hidden" name="absent" value="0" />
              <button type="submit" className="ghost">O secretário voltou a preencher</button>
            </form>
          )}
        </div>
        {!canSubmit && lesson.report_status !== "enviada" && lesson.report_status !== "validada" && (
          <p className="muted small" style={{ margin: 0 }}>
            O envio fica disponível para quem preenche a aula, depois de salvar a presença.
          </p>
        )}
        {lesson.report_status === "enviada" && <p className="muted small" style={{ margin: 0 }}>Enviado: aguardando a validação da secretaria geral.</p>}
        {lesson.report_status === "validada" && <p className="muted small" style={{ margin: 0 }}>Relatório validado. Alterações só depois de devolvido.</p>}
      </div>
    </>
  );
}
