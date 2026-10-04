import { getSettings } from "@/lib/church";
import { congregationName } from "@/lib/church";

/** Timbre da igreja para relatórios e documentos impressos (logo, nome, endereço). */
export function Letterhead({
  title, subtitle, congregationId, printOnly = false,
}: { title: string; subtitle?: string; congregationId?: number | null; printOnly?: boolean }) {
  const s = getSettings();
  const cong = congregationName(congregationId ?? null);
  return (
    <header className={`letterhead${printOnly ? " print-only" : ""}`}>
      {s.logo && <img src={`/arquivos/${s.logo}`} alt="" className="lh-logo" />}
      <div className="lh-text">
        <strong className="lh-church">{s.church_name}</strong>
        <span className="lh-sub">
          Escola Bíblica Dominical{cong ? ` · ${cong}` : ""}
          {s.president ? ` · Pastor Presidente: ${s.president}` : ""}
        </span>
        {(s.address || s.city) && <span className="lh-sub">{[s.address, s.city].filter(Boolean).join(" · ")}{s.cnpj ? ` · CNPJ ${s.cnpj}` : ""}</span>}
      </div>
      <div className="lh-title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </header>
  );
}
