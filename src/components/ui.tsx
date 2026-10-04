import { REPORT_LABEL, type ReportStatus } from "@/lib/abac";
import type { Flash } from "@/lib/guard";

export function FlashMessage({ flash }: { flash: Flash }) {
  if (flash.erro) return <div className="flash erro" role="alert">{flash.erro}</div>;
  if (flash.ok) return <div className="flash ok" role="status">{flash.ok}</div>;
  return null;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "realizada" ? "ok" : status === "cancelada" ? "bad" : "";
  const label = status === "realizada" ? "Realizada" : status === "cancelada" ? "Cancelada" : "Escalada";
  return <span className={`badge ${cls}`}>{label}</span>;
}

const REPORT_CLASS: Record<ReportStatus, string> = { pendente: "warn", enviada: "", validada: "ok", devolvida: "bad" };

/** Situação do relatório da aula (pendente → enviada → validada, ou devolvida para correção). */
export function ReportBadge({ status, title }: { status: ReportStatus; title?: string }) {
  return <span className={`badge ${REPORT_CLASS[status]}`} title={title}>{REPORT_LABEL[status]}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted">{children}</p>;
}
