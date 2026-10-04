import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDay } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { listValidationQueue, type QueueRow } from "@/lib/repo";
import { Empty, FlashMessage } from "@/components/ui";

function Table({ rows, action, who }: { rows: QueueRow[]; action: string; who: "envio" | "secretario" }) {
  if (rows.length === 0) return <Empty>Nada por aqui.</Empty>;
  return (
    <table>
      <thead>
        <tr><th>Data</th><th>Classe</th><th>{who === "envio" ? "Enviado por" : "Secretário(a) da sala"}</th><th>Oferta</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.id}>
            <td className="nowrap">{fmtDay(l.date)}</td>
            <td>{l.class_name}</td>
            <td>
              {who === "envio"
                ? l.submitted_by_name ?? "—"
                : l.secretary_name ?? <span className="muted">sem secretário — {l.teacher_name ?? "sem professor"}</span>}
              {l.return_note && <div className="muted small">Motivo da devolução: {l.return_note}</div>}
            </td>
            <td className="nowrap">{(l.offering_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
            <td className="right"><Link className="btn small ghost" href={`/validacao/${l.id}`}>{action}</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ValidationPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const q = guarded(() => listValidationQueue(user));
  return (
    <>
      <h1>Validação dos relatórios</h1>
      <p className="muted">
        Cada secretário de sala envia o relatório da aula (presença, visitantes e oferta). A secretaria geral confere e
        valida; só os relatórios validados entram no relatório consolidado da EBD.
      </p>
      <FlashMessage flash={flash} />

      <h2>Aguardando validação ({q.awaiting.length})</h2>
      <div className="card table-wrap"><Table rows={q.awaiting} action="Revisar" who="envio" /></div>

      <h2>Devolvidos para correção ({q.returned.length})</h2>
      <div className="card table-wrap"><Table rows={q.returned} action="Ver" who="secretario" /></div>

      <h2>Ainda não enviados ({q.missing.length})</h2>
      <p className="muted small">Aulas já realizadas (ou em andamento) cujo secretário ainda não enviou o relatório.</p>
      <div className="card table-wrap"><Table rows={q.missing} action="Ver" who="secretario" /></div>
    </>
  );
}
