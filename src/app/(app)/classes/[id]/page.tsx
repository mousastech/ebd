import { notFound } from "next/navigation";
import {
  addStaffAction, enrollAction, removeStaffAction, setClassGroupAction, unenrollAction,
} from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { FN_LABEL } from "@/lib/labels";
import { can } from "@/lib/abac";
import { getClassDetail, getClassInsights, listGroups, listPeople } from "@/lib/repo";
import { brl, parseQuarter, quarterLabel } from "@/lib/format";
import { Avatar, Hero, LineChart, pctTone } from "@/components/app-ui";
import Link from "next/link";
import { Empty, FlashMessage } from "@/components/ui";

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Flash>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const flash = await searchParams;
  const detail = guarded(() => getClassDetail(user, Number(id)));
  if (!detail) notFound();
  const { cls, staff, students, canEdit, canEnroll, canMove, group } = detail;

  // candidatos para os formulários (somente quem pode ver o cadastro de pessoas)
  const people = canEdit || canEnroll ? listPeople(user) : [];
  const groups = canMove ? listGroups(user) : [];
  const quarter = parseQuarter(undefined);
  const insights = can(user, "read", { type: "attendance", classIds: [cls.id] }) ? getClassInsights(user, cls.id, quarter) : null;
  const recordedSeries = insights?.series.filter((l) => l.total > 0) ?? [];
  const sumP = recordedSeries.reduce((n, l) => n + l.presentes, 0);
  const sumT = recordedSeries.reduce((n, l) => n + l.total, 0);
  const recentPct = sumT ? Math.round((sumP / sumT) * 100) : null;
  const enrolledIds = new Set(students.map((s) => s.id));

  return (
    <>
      <div className="pagehead">
        <Link href="/classes" className="back" aria-label="Voltar">←</Link>
        <div>
          <h1>{cls.name}</h1>
          <p className="muted small">
            {cls.age_range} · {group ? `${group.name} — coordenador(a): ${group.coordinator ?? "não designado"}` : "sem escala"}
          </p>
        </div>
      </div>
      <Hero
        icon="🎓"
        value={cls.name}
        stats={[
          { label: "Alunos", value: students.length },
          { label: "Aulas", value: recordedSeries.length },
          { label: "Presença", value: recentPct != null ? `${recentPct}%` : "—" },
        ]}
      />
      <FlashMessage flash={flash} />

      {insights && (
        <>
          <div className="card">
            <h3>Presença</h3>
            <p className="muted small">Alunos presentes nas últimas {recordedSeries.length} aulas com chamada.</p>
            {recordedSeries.length === 0 ? <Empty>Sem chamadas lançadas.</Empty> : (
              <LineChart points={recordedSeries.map((l) => ({ label: `${l.date.slice(8)}/${l.date.slice(5, 7)}`, value: l.total ? l.presentes : null }))} />
            )}
          </div>

          <div className="card list-rows">
            <div className="lrow"><span className="lrow-ic">%</span><span>Aproveitamento — {quarterLabel(quarter)}<strong>{insights.aproveitamento != null ? `${insights.aproveitamento}%` : "—"}
              {insights.delta != null && insights.delta !== 0 && <small className={insights.delta > 0 ? "up" : "down"}> {insights.delta > 0 ? "↗ +" : "↘ "}{insights.delta} pts vs. tri anterior</small>}</strong></span></div>
            <div className="lrow"><span className="lrow-ic">$</span><span>Ofertas do trimestre (validadas)<strong>{brl(insights.ofertaCents)}</strong></span></div>
            <div className="lrow"><span className="lrow-ic">🎂</span><span>Aniversariantes do mês<strong>{insights.birthdays.length ? insights.birthdays.map((b) => `${b.name} (${String(b.day).padStart(2, "0")})`).join(", ") : "0"}</strong></span></div>
          </div>

          {insights.ranking && insights.ranking.length > 0 && (
            <div className="card">
              <h3>Ranking de presença</h3>
              <p className="muted small">Top 10 alunos no trimestre (aulas validadas).</p>
              <ol className="ranking">
                {insights.ranking.slice(0, 10).map((a, i) => (
                  <li key={a.id} className={i < 3 ? "top" : ""}>
                    <span className="pos">{i + 1}</span><span className="nm">{a.name}</span>
                    <span className="sc">{a.presentes}/{a.total} ({a.pct}%)</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="card">
            <h3>Últimas aulas</h3>
            <div className="lessons">
              {[...insights.series].reverse().map((l, i, arr) => {
                const pct = l.total ? Math.round((l.presentes / l.total) * 100) : null;
                return (
                  <Link key={l.id} href={`/presenca/${l.id}`} className="lesson-row">
                    <span className="num">{arr.length - i}</span>
                    <span className="grow"><strong>{fmtDate(l.date)}</strong><small className="muted">{l.presentes}/{l.total || students.length} presentes · {brl(l.offering_cents)}</small></span>
                    <span className={`badge ${pct === null ? "" : pctTone(pct) === "ok" ? "ok" : pctTone(pct) === "bad" ? "bad" : "warn"}`}>{pct === null ? "—" : `${pct}%`}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      <h2>Equipe</h2>
      <div className="card table-wrap">
        {staff.length === 0 ? <Empty>Sem equipe cadastrada.</Empty> : (
          <table>
            <thead><tr><th>Nome</th><th>Função</th><th></th></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={`${s.person_id}-${s.function}`}>
                  <td>{s.name}</td>
                  <td><span className="badge">{FN_LABEL[s.function]}</span></td>
                  <td className="right">
                    {canEdit && (
                      <form action={removeStaffAction}>
                        <input type="hidden" name="class_id" value={cls.id} />
                        <input type="hidden" name="person_id" value={s.person_id} />
                        <input type="hidden" name="function" value={s.function} />
                        <button className="danger small" type="submit">Remover</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <form action={addStaffAction} className="card">
          <input type="hidden" name="class_id" value={cls.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="sp">Pessoa</label>
              <select id="sp" name="person_id" required>
                <option value="">Selecione…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sf">Função</label>
              <select id="sf" name="function">
                <option value="professor">Professor</option>
                <option value="colaborador">Colaborador</option>
                <option value="secretario">Secretário(a) da sala (substitui o atual)</option>
              </select>
            </div>
            <button type="submit">Adicionar à equipe</button>
          </div>
        </form>
      )}

      {canMove && (
        <form action={setClassGroupAction} className="card">
          <input type="hidden" name="class_id" value={cls.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="mg">Escala</label>
              <select id="mg" name="group_id" defaultValue={cls.group_id ?? ""}>
                <option value="">— sem escala —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button type="submit">Mover de escala</button>
          </div>
        </form>
      )}

      <h2>Alunos ({students.length})</h2>
      <div className="card people-list">
        {students.length === 0 ? <Empty>Nenhum aluno visível para você.</Empty> : students.map((s) => (
          <div key={s.id} className="person-row">
            <Avatar name={s.name} />
            <Link href={`/pessoas/${s.id}`} className="grow">
              <strong>{s.name}</strong>
              <small className="muted">{fmtDate(s.birth_date)}{s.phone ? ` · ${s.phone}` : ""}</small>
            </Link>
            {canEnroll && (
              <form action={unenrollAction}>
                <input type="hidden" name="class_id" value={cls.id} />
                <input type="hidden" name="person_id" value={s.id} />
                <button className="danger small" type="submit" aria-label={`Remover ${s.name}`}>Remover</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {canEnroll && (
        <form action={enrollAction} className="card">
          <input type="hidden" name="class_id" value={cls.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="ep">Matricular aluno</label>
              <select id="ep" name="person_id" required>
                <option value="">Selecione…</option>
                {people.filter((p) => !enrolledIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button type="submit">Matricular</button>
          </div>
        </form>
      )}
    </>
  );
}
