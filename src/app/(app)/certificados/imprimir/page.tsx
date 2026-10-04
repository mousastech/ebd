import Link from "next/link";
import { can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { DEFAULT_MIN_PCT, eligibleStudents, myCertificates, type CertificateRow } from "@/lib/certificates";
import { getSettings } from "@/lib/church";
import { parseQuarter, quarterKey, quarterLabel, todayISO } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function PrintCertificates({ searchParams }: { searchParams: Promise<{ t?: string; ids?: string | string[] }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = parseQuarter(sp.t);
  const wanted = new Set([sp.ids ?? []].flat());
  // só imprime quem a pessoa pode emitir (ou o próprio certificado), e que de fato atingiu a frequência mínima
  const canIssue = (classId: number) => can(user, "create", { type: "certificate", classIds: [classId] });
  const pool: CertificateRow[] = [
    ...(user.enrolled.length ? myCertificates(user, q) : []),
    ...(() => { try { return eligibleStudents(user, q, DEFAULT_MIN_PCT); } catch { return []; } })(),
  ];
  const seen = new Set<string>();
  const certs = pool.filter((r) => {
    const k = `${r.person_id}:${r.class_id}`;
    if (!wanted.has(k) || seen.has(k)) return false;
    seen.add(k);
    return r.person_id === user.personId || canIssue(r.class_id);
  });
  const s = getSettings();

  return (
    <>
      <div className="row noprint" style={{ marginBottom: "1rem" }}>
        <Link className="btn ghost small" href={`/certificados?t=${quarterKey(q)}`}>← Voltar</Link>
        <PrintButton label="Imprimir / salvar em PDF" />
      </div>
      {certs.length === 0 ? <Empty>Nenhum certificado selecionado.</Empty> : certs.map((c) => (
        <section key={`${c.person_id}:${c.class_id}`} className="certificate">
          <div className="cert-inner">
            {s.logo && <img src={`/arquivos/${s.logo}`} alt="" className="cert-logo" />}
            <div className="cert-church">{s.church_name}</div>
            <div className="cert-sub">Escola Bíblica Dominical</div>
            <h1 className="cert-title">Certificado</h1>
            <p className="cert-text">Certificamos que</p>
            <p className="cert-name">{c.name}</p>
            <p className="cert-text">
              participou com dedicação da Classe <strong>{c.class_name}</strong> no <strong>{quarterLabel(q)}</strong>,
              com <strong>{c.pct}%</strong> de frequência ({c.presentes} de {c.total} aulas).
            </p>
            <p className="cert-verse">“Procura apresentar-te a Deus aprovado, como obreiro que não tem de que se envergonhar.” — 2 Tm 2.15</p>
            <p className="cert-date">{s.city ? `${s.city.split("·")[0].trim()}, ` : ""}{longDate(todayISO())}.</p>
            <div className="cert-signs">
              <div><span />Superintendente da EBD</div>
              <div><span />{s.president ? `Pr. ${s.president.replace(/^Pr\.?\s*/i, "")}` : "Pastor Presidente"}</div>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
