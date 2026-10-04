import Link from "next/link";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { DEFAULT_MIN_PCT, eligibleStudents, myCertificates } from "@/lib/certificates";
import { parseQuarter, quarterKey, quarterLabel, shiftQuarter } from "@/lib/format";
import { listClasses } from "@/lib/repo";
import { Empty } from "@/components/ui";

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<{ t?: string; classe?: string; min?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = parseQuarter(sp.t);
  const key = quarterKey(q);
  const min = Math.min(100, Math.max(0, Number(sp.min) || DEFAULT_MIN_PCT));
  const issuer = listClasses(user).some((c) => can(user, "create", { type: "certificate", classIds: [c.id] }));
  const classes = listClasses(user).filter((c) => can(user, "create", { type: "certificate", classIds: [c.id] }));
  const classId = Number(sp.classe) || undefined;
  const rows = issuer ? eligibleStudents(user, q, min, classId) : [];
  const mine = myCertificates(user, q, min);

  return (
    <>
      <div className="pagehead"><div><h1>Certificados</h1><p className="muted small">Frequência do {quarterLabel(q)} (aulas validadas) · mínimo {min}%</p></div></div>
      <div className="row" style={{ marginBottom: ".6rem" }}>
        <Link className="btn ghost small" href={`/certificados?t=${quarterKey(shiftQuarter(q, -1))}`}>← Trimestre anterior</Link>
        <Link className="btn ghost small" href={`/certificados?t=${quarterKey(shiftQuarter(q, 1))}`}>Próximo →</Link>
      </div>

      {mine.length > 0 && (
        <div className="card">
          <h3>Meus certificados</h3>
          {mine.map((m) => (
            <div key={m.class_id} className="row between">
              <span>{m.class_name} · {m.pct}% de presença</span>
              <Link className="btn small" href={`/certificados/imprimir?t=${key}&ids=${m.person_id}:${m.class_id}`}>Imprimir</Link>
            </div>
          ))}
        </div>
      )}

      {issuer && (
        <>
          <form className="card form-grid" action="/certificados">
            <input type="hidden" name="t" value={key} />
            <div><label htmlFor="cc">Classe</label>
              <select id="cc" name="classe" defaultValue={classId ?? ""}><option value="">Todas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div><label htmlFor="cm">Frequência mínima (%)</label><input id="cm" name="min" type="number" min={0} max={100} defaultValue={min} /></div>
            <button type="submit" className="ghost">Filtrar</button>
          </form>
          {rows.length === 0 ? <Empty>Nenhum aluno atingiu a frequência mínima (ou o trimestre ainda não tem aulas validadas).</Empty> : (
            <form action="/certificados/imprimir" className="card">
              <input type="hidden" name="t" value={key} />
              <div className="row between"><strong>{rows.length} aluno(s) aptos</strong><button type="submit">Imprimir selecionados</button></div>
              <div className="checks" style={{ marginTop: ".6rem" }}>
                {rows.map((r) => (
                  <label key={`${r.person_id}:${r.class_id}`} className="check">
                    <input type="checkbox" name="ids" value={`${r.person_id}:${r.class_id}`} defaultChecked />
                    <span>{r.name}<br /><small className="muted">{r.class_name} · {r.presentes}/{r.total} ({r.pct}%)</small></span>
                  </label>
                ))}
              </div>
            </form>
          )}
        </>
      )}
      {!issuer && mine.length === 0 && <Empty>Nenhum certificado disponível neste trimestre.</Empty>}
    </>
  );
}
