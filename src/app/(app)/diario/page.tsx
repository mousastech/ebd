import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDay } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { listDiary } from "@/lib/repo";
import { Empty, FlashMessage, ReportBadge } from "@/components/ui";

export default async function DiaryPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const rows = guarded(() => listDiary(user));
  return (
    <>
      <h1>Diário de classe</h1>
      <p className="muted">
        Registro do tema, dos visitantes, da <strong>oferta</strong> e das observações de cada aula, feito pelo secretário
        da sala (ou pelo professor escalado, na ausência dele).
      </p>
      <FlashMessage flash={flash} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>Nenhuma aula disponível.</Empty> : (
          <table>
            <thead><tr><th>Data</th><th>Classe</th><th>Professor</th><th>Tema</th><th>Relatório</th><th></th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{fmtDay(l.date)}</td>
                  <td>{l.class_name}</td>
                  <td>{l.teacher_name ?? "—"}</td>
                  <td>{l.topic ?? "—"}</td>
                  <td><ReportBadge status={l.report_status} /></td>
                  <td className="right">
                    <Link className="btn small ghost" href={`/diario/${l.id}`}>{l.canEdit ? "Preencher" : "Abrir"}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
