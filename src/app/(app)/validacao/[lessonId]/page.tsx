import Link from "next/link";
import { returnReportAction, validateReportAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { brl, fmtDate, fmtDay } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { getReportReview } from "@/lib/repo";
import { FlashMessage, ReportBadge } from "@/components/ui";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<Flash>;
}) {
  const user = await requireUser();
  const { lessonId } = await params;
  const flash = await searchParams;
  const r = guarded(() => getReportReview(user, Number(lessonId)));
  const l = r.lesson;
  const presentes = r.people.filter((p) => p.present);
  const ausentes = r.people.filter((p) => !p.present);
  const sentAt = l.submitted_at ? fmtDate(l.submitted_at.slice(0, 10)) : null;

  return (
    <>
      <p className="small"><Link href="/validacao">← Voltar à fila</Link></p>
      <h1>Relatório — {l.class_name}</h1>
      <p className="muted">
        {fmtDay(l.date)} · <ReportBadge status={l.report_status} />
        {r.submittedBy && <> · enviado por {r.submittedBy}{sentAt && ` em ${sentAt}`}</>}
        {r.validatedBy && <> · validado por {r.validatedBy}</>}
      </p>
      <FlashMessage flash={flash} />
      {l.return_note && l.report_status === "devolvida" && (
        <div className="note"><strong>Devolvido:</strong> {l.return_note}</div>
      )}

      <div className="grid">
        <div className="card">
          <div className="muted small">Alunos presentes</div>
          <div className="stat">{r.alunosPresentes}/{r.alunosTotal}</div>
        </div>
        <div className="card">
          <div className="muted small">Visitantes</div>
          <div className="stat">{l.visitors}</div>
        </div>
        <div className="card">
          <div className="muted small">Oferta</div>
          <div className="stat">{brl(l.offering_cents)}</div>
        </div>
      </div>

      <div className="card stack">
        <div><strong>Tema:</strong> {l.topic ?? "—"}</div>
        <div><strong>Professor:</strong> {l.teacher_name ?? "—"} · <strong>Secretário(a):</strong> {r.secretary ?? "não designado"}</div>
        <div><strong>Observações:</strong> {l.notes ?? "—"}</div>
        <div><strong>Presentes ({presentes.length}):</strong> {presentes.map((p) => p.name).join(", ") || "—"}</div>
        <div><strong>Ausentes ({ausentes.length}):</strong> {ausentes.map((p) => p.name).join(", ") || "—"}</div>
        <p className="small" style={{ margin: 0 }}>
          <Link href={`/presenca/${l.id}`}>Corrigir presença</Link> · <Link href={`/diario/${l.id}`}>Corrigir diário</Link>
        </p>
      </div>

      {(r.canValidate || r.canReturn) && (
        <div className="grid">
          {r.canValidate && (
            <form action={validateReportAction} className="card stack">
              <input type="hidden" name="lesson_id" value={l.id} />
              <h3>Validar</h3>
              <p className="muted small">Confirma que a presença e a oferta conferem. O relatório passa a compor o consolidado.</p>
              <button type="submit">Validar relatório</button>
            </form>
          )}
          {r.canReturn && (
            <form action={returnReportAction} className="card stack">
              <input type="hidden" name="lesson_id" value={l.id} />
              <h3>{l.report_status === "validada" ? "Reabrir (devolver)" : "Devolver para correção"}</h3>
              <div>
                <label htmlFor="note">O que precisa ser corrigido?</label>
                <textarea id="note" name="note" required minLength={3} />
              </div>
              <button type="submit" className="danger">Devolver ao secretário</button>
            </form>
          )}
        </div>
      )}
      {l.report_status === "enviada" && !r.canValidate && (
        <p className="muted small">Quem enviou o relatório não pode validá-lo; outra pessoa da secretaria geral precisa conferir.</p>
      )}
    </>
  );
}
