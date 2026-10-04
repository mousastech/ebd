import Link from "next/link";
import { saveDiaryAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { brl, fmtDay } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { getDiary } from "@/lib/repo";
import { FlashMessage, ReportBadge } from "@/components/ui";

export default async function DiaryEntry({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<Flash>;
}) {
  const user = await requireUser();
  const { lessonId } = await params;
  const flash = await searchParams;
  const d = guarded(() => getDiary(user, Number(lessonId)));
  const l = d.lesson;

  return (
    <>
      <p className="small"><Link href="/diario">← Voltar</Link></p>
      <h1>Diário — {l.class_name}</h1>
      <p className="muted">
        {fmtDay(l.date)} · Professor: {l.teacher_name ?? "—"} · Alunos presentes: {d.alunosPresentes}/{d.alunosTotal} ·
        Relatório: <ReportBadge status={l.report_status} />
      </p>
      <FlashMessage flash={flash} />
      {l.report_status === "devolvida" && l.return_note && (
        <div className="note" role="alert"><strong>Devolvido pela secretaria geral:</strong> {l.return_note}</div>
      )}
      <div className="hint">{d.hint}</div>

      <form action={saveDiaryAction} className="card stack">
        <input type="hidden" name="lesson_id" value={l.id} />
        <div>
          <label htmlFor="topic">Tema da lição</label>
          <input id="topic" name="topic" defaultValue={l.topic ?? ""} readOnly={!d.canEdit} />
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="visitors">Visitantes</label>
            <input id="visitors" name="visitors" type="number" min={0} defaultValue={l.visitors} readOnly={!d.canEdit} />
          </div>
          <div>
            <label htmlFor="offering">Oferta (R$)</label>
            <input id="offering" name="offering" inputMode="decimal" defaultValue={(l.offering_cents / 100).toFixed(2).replace(".", ",")} readOnly={!d.canEdit} />
          </div>
        </div>
        <div>
          <label htmlFor="notes">Observações</label>
          <textarea id="notes" name="notes" defaultValue={l.notes ?? ""} readOnly={!d.canEdit} />
        </div>
        {d.canEdit ? (
          <div className="row">
            <button type="submit">Salvar diário</button>
            <Link href={`/presenca/${l.id}`} className="small">Ir para a chamada e o envio do relatório →</Link>
          </div>
        ) : (
          <p className="muted small">Somente leitura. Oferta registrada: {brl(l.offering_cents)}.</p>
        )}
      </form>
    </>
  );
}
