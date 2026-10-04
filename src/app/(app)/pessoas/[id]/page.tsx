import { Letterhead } from "@/components/Letterhead";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORT_LABEL } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { brl, fmtDate, fmtDay } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { CATEGORY_SINGULAR, FN_LABEL } from "@/lib/labels";
import { getPersonFile } from "@/lib/repo";
import { PrintButton } from "@/components/PrintButton";
import { Empty, FlashMessage } from "@/components/ui";
import { Avatar } from "@/components/app-ui";
import { PhotoInput } from "@/components/PhotoInput";
import { removePhotoAction, setPersonCongregationAction, uploadPhotoAction } from "@/app/actions-church";
import { congregationName, listCongregations } from "@/lib/church";
import type { Flash } from "@/lib/guard";

/** Ficha individual: dados, vínculos, frequência por trimestre, últimas presenças e revistas. */
export default async function PersonFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const { id } = await params;
  const flash = await searchParams;
  const f = guarded(() => getPersonFile(user, Number(id)));
  if (!f) notFound();
  const p = f.person;
  const canPhoto = f.canEdit || p.id === user.personId;
  const congs = f.canEdit ? listCongregations(user) : [];

  return (
    <>
      <Letterhead printOnly title="Ficha individual" congregationId={p.congregation_id} />
      <div className="row between">
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "center" }}>
          {p.photo ? <img src={`/arquivos/${p.photo}`} alt="" className="photo-lg" /> : <Avatar name={p.name} />}
          <div>
          <p className="small noprint" style={{ margin: 0 }}><Link href="/pessoas">← Pessoas</Link></p>
          <h1>{p.name}</h1>
          {congs.length > 1 && <span className="muted small">{congregationName(p.congregation_id)}</span>}
          <div>{p.categories.map((c) => <span key={c} className="badge" style={{ marginRight: 4 }}>{CATEGORY_SINGULAR[c]}</span>)}</div>
          </div>
        </div>
        <div className="noprint"><PrintButton label="Imprimir ficha" /></div>
      </div>

      <FlashMessage flash={flash} />
      {canPhoto && (
        <div className="card noprint">
          <h3>Foto</h3>
          <div className="row">
            <form action={uploadPhotoAction} className="row">
              <input type="hidden" name="person_id" value={p.id} />
              <PhotoInput name="photo" label={p.photo ? "Trocar foto" : "Escolher foto"} />
              <button type="submit" className="small">Salvar foto</button>
            </form>
            {p.photo && (
              <form action={removePhotoAction}>
                <input type="hidden" name="person_id" value={p.id} />
                <button type="submit" className="danger small">Remover</button>
              </form>
            )}
          </div>
        </div>
      )}
      {congs.length > 1 && (
        <form action={setPersonCongregationAction} className="card row noprint">
          <input type="hidden" name="person_id" value={p.id} />
          <label htmlFor="pc" style={{ margin: 0 }}>Congregação</label>
          <select id="pc" name="congregation_id" defaultValue={p.congregation_id} style={{ maxWidth: 260 }}>
            {congs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" className="ghost small">Transferir</button>
        </form>
      )}

      <div className="grid" style={{ marginTop: "1rem" }}>
        <div className="card">
          <h3>Dados</h3>
          <div><strong>Nascimento:</strong> {fmtDate(p.birth_date)}{f.birthday && ` (${f.birthday.turning} anos este ano)`}</div>
          <div><strong>Telefone:</strong> {p.phone ?? <span className="muted">restrito</span>}</div>
          {(p.guardian_name || p.phone === null) && <div><strong>Responsável:</strong> {p.guardian_name ?? <span className="muted">—</span>}</div>}
          {f.canEdit && <p className="small" style={{ marginTop: ".5rem" }}><Link href="/pessoas">Editar no cadastro</Link></p>}
        </div>
        <div className="card">
          <h3>Vínculos</h3>
          {f.studentOf.length === 0 && f.staffOf.length === 0 && <Empty>Sem vínculo com classes.</Empty>}
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {f.studentOf.map((c) => <li key={`a${c}`}>Aluno(a) — {c}</li>)}
            {f.staffOf.map((s) => <li key={`${s.class_name}${s.function}`}>{FN_LABEL[s.function] ?? s.function} — {s.class_name}</li>)}
          </ul>
        </div>
      </div>

      <h2>Frequência por trimestre</h2>
      <div className="card table-wrap">
        {f.quarters.length === 0 ? <Empty>Sem presenças validadas visíveis para você.</Empty> : (
          <table>
            <thead><tr><th>Trimestre</th><th>Presenças</th><th>%</th></tr></thead>
            <tbody>
              {f.quarters.map((q) => (
                <tr key={q.label}>
                  <td>{q.label}</td><td>{q.presentes}/{q.total}</td>
                  <td><span className={`badge ${q.pct >= 75 ? "ok" : q.pct >= 50 ? "warn" : "bad"}`}>{q.pct.toLocaleString("pt-BR")}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Últimas aulas</h2>
      <div className="card table-wrap">
        {f.recent.length === 0 ? <Empty>Nenhuma chamada registrada.</Empty> : (
          <table>
            <thead><tr><th>Data</th><th>Classe</th><th>Situação</th><th>Relatório</th></tr></thead>
            <tbody>
              {f.recent.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDay(r.date)}</td>
                  <td>{r.class_name}{r.asTeacher && <span className="muted small"> (lecionou)</span>}</td>
                  <td>{r.present ? <span className="badge ok">Presente</span> : <span className="badge bad">Falta</span>}</td>
                  <td className="muted small">{REPORT_LABEL[r.report_status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {f.orders.length > 0 && (
        <>
          <h2>Revistas</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Revista</th><th>Valor</th><th>Pago</th><th>Saldo</th></tr></thead>
              <tbody>
                {f.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.material_title}<div className="muted small">{o.period}</div></td>
                    <td>{brl(o.price_cents)}</td><td>{brl(o.paid_cents)}</td>
                    <td>{o.balance_cents === 0 ? <span className="badge ok">Quitada</span> : <span className="badge warn">{brl(o.balance_cents)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
