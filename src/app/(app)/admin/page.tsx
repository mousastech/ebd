import { Letterhead } from "@/components/Letterhead";
import Link from "next/link";
import {
  ACTION_LABEL, ALL_RESOURCE_TYPES, RESOURCE_LABEL, ROLES, ROLE_LABEL, can, canSeeSomething, permissionMatrix,
} from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/church";
import { brl, fmtDay, parseQuarter, quarterKey, quarterLabel, quarterRange, shiftQuarter, todayISO } from "@/lib/format";
import { classThermometer, teacherRanking } from "@/lib/insights";
import { visitorFunnel } from "@/lib/visitors";
import { guarded } from "@/lib/guard";
import { frequency, getBI, usersByRole, type Tally } from "@/lib/repo";
import { Columns, HBars, Stacked } from "@/components/charts";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";

/** Link do WhatsApp para contato pastoral (DDD brasileiro sem o 55 recebe o código do país). */
const whatsapp = (phone: string, name: string) => {
  const d = phone.replace(/\D/g, "");
  const n = d.length === 10 || d.length === 11 ? `55${d}` : d;
  const msg = `Olá! Sentimos sua falta na EBD, ${name.split(" ")[0]}. Está tudo bem? Esperamos você no domingo!`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
};

const pctTxt = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const tone = (p: number | null) => (p === null ? "brand" : p >= 75 ? "ok" : p >= 50 ? "warn" : "bad");
const teacherPct = (t: Tally) => (t.professoresRegistros ? (t.professoresPresentes / t.professoresRegistros) * 100 : null);

function Delta({ now, prev, suffix = "", money = false }: { now: number | null; prev: number | null; suffix?: string; money?: boolean }) {
  if (now === null || prev === null || prev === 0) return null;
  const d = now - prev;
  if (Math.abs(d) < 0.05) return <div className="kpi-delta muted">= trimestre anterior</div>;
  const txt = money ? brl(Math.abs(d)) : `${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
  return <div className={`kpi-delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {txt} vs. anterior</div>;
}

type Tab = "visao" | "relatorios" | "acessos";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ t?: string; aba?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const quarter = parseQuarter(sp.t);
  const key = quarterKey(quarter);
  const canAccess = can(user, "read", { type: "user" });
  const tab: Tab = sp.aba === "relatorios" ? "relatorios" : sp.aba === "acessos" && canAccess ? "acessos" : "visao";
  const bi = guarded(() => getBI(user, quarter));
  const prev = bi.trend[bi.trend.length - 2];
  const thermo = classThermometer(user, todayISO());
  const ranking = teacherRanking(user, quarter);
  const funnel = canSeeSomething(user, "visitor") ? visitorFunnel(user, quarterRange(quarter).from, quarterRange(quarter).to) : null;
  const cur = bi.trend[bi.trend.length - 1];
  const scopeAll = can(user, "read", { type: "consolidated" });
  const href = (over: Partial<{ t: string; aba: Tab }>) => {
    const p = new URLSearchParams({ t: over.t ?? key, aba: over.aba ?? tab });
    return `/admin?${p}`;
  };

  return (
    <>
      <Letterhead printOnly title="Painel da EBD" subtitle={quarterLabel(quarter)} congregationId={user.view} />
      <div className="row between">
        <div>
          <h1>Painel administrativo</h1>
          <p className="muted" style={{ margin: 0 }}>
            {quarterLabel(quarter)} · {scopeAll ? "toda a EBD" : `escopo: ${bi.groups.map((g) => g.name).join(", ") || "suas classes"}`}
          </p>
        </div>
        <div className="row noprint">
          <Link className="btn ghost small" href={href({ t: quarterKey(shiftQuarter(quarter, -1)) })}>← Anterior</Link>
          <Link className="btn ghost small" href={`/admin?aba=${tab}`}>Atual</Link>
          <Link className="btn ghost small" href={href({ t: quarterKey(shiftQuarter(quarter, 1)) })}>Próximo →</Link>
          <PrintButton />
        </div>
      </div>

      <nav className="tabs noprint" aria-label="Seções do painel">
        <Link href={href({ aba: "visao" })} className={tab === "visao" ? "active" : ""}>Indicadores (BI)</Link>
        <Link href={href({ aba: "relatorios" })} className={tab === "relatorios" ? "active" : ""}>Central de relatórios</Link>
        {canAccess && <Link href={href({ aba: "acessos" })} className={tab === "acessos" ? "active" : ""}>Controle de acesso</Link>}
      </nav>

      {tab === "visao" && (
        <>
          <div className="kpis">
            <div className="card">
              <div className="muted small">Frequência dos alunos</div>
              <div className="stat">{cur.frequencia === null ? "—" : pctTxt(cur.frequencia)}</div>
              <Delta now={cur.frequencia} prev={prev.frequencia} suffix=" p.p." />
            </div>
            <div className="card">
              <div className="muted small">Média de alunos por aula</div>
              <div className="stat">{bi.mediaPorAula ?? "—"}</div>
              <div className="muted small">{bi.people.matriculados} matriculados</div>
            </div>
            <div className="card">
              <div className="muted small">Ofertas</div>
              <div className="stat">{brl(cur.ofertaCents)}</div>
              <Delta now={cur.ofertaCents} prev={prev.ofertaCents} money />
            </div>
            <div className="card">
              <div className="muted small">Visitantes</div>
              <div className="stat">{cur.visitantes}</div>
              <Delta now={cur.visitantes} prev={prev.visitantes} />
            </div>
            <div className="card">
              <div className="muted small">Professores presentes</div>
              <div className="stat">{(() => { const p = teacherPct(bi.current.total); return p === null ? "—" : pctTxt(p); })()}</div>
              <div className="muted small">{bi.people.professores} professores</div>
            </div>
            <div className="card">
              <div className="muted small">Relatórios validados</div>
              <div className="stat">{bi.reports.validada}/{bi.reports.validada + bi.reports.enviada + bi.reports.devolvida + bi.reports.pendente}</div>
              <div className="muted small">aulas já realizadas</div>
            </div>
          </div>

          {bi.current.total.pendencias > 0 && (
            <div className="note">
              {bi.current.total.pendencias} aula(s) ainda sem relatório validado — os indicadores consideram apenas o que a
              secretaria geral já validou. {can(user, "update", { type: "report" }) && <Link href="/validacao">Ir para a validação →</Link>}
            </div>
          )}

          <div className="bi-grid">
            <div className="card">
              <h3>Frequência — últimos 4 trimestres</h3>
              <Columns points={bi.trend.map((t) => ({ label: `${t.quarter.q}º/${String(t.quarter.year).slice(2)}`, value: t.frequencia }))} format={pctTxt} />
            </div>
            <div className="card">
              <h3>Ofertas — últimos 4 trimestres</h3>
              <Columns points={bi.trend.map((t) => ({ label: `${t.quarter.q}º/${String(t.quarter.year).slice(2)}`, value: t.ofertaCents }))} format={(v) => brl(v)} />
            </div>
            <div className="card">
              <h3>Situação dos relatórios</h3>
              <Stacked parts={[
                { label: "Validados", value: bi.reports.validada, tone: "ok" },
                { label: "Aguardando validação", value: bi.reports.enviada, tone: "brand" },
                { label: "Devolvidos", value: bi.reports.devolvida, tone: "bad" },
                { label: "Não enviados", value: bi.reports.pendente, tone: "warn" },
              ]} />
              <p className="small muted" style={{ marginTop: ".6rem" }}>
                Salas sem secretário designado: <strong>{bi.people.salasSemSecretario}</strong>
              </p>
            </div>
          </div>

          <h2>Por Escala</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Escala</th><th>Coordenador(a)</th><th>Classes</th><th>Matriculados</th><th>Frequência</th><th>Professores</th><th>Visitantes</th><th>Oferta</th><th>Pendências</th></tr></thead>
              <tbody>
                {bi.groups.map((g) => {
                  const f = frequency(g.total);
                  const tp = teacherPct(g.total);
                  return (
                    <tr key={String(g.id)}>
                      <td><strong>{g.name}</strong></td>
                      <td>{g.coordinator ?? <span className="muted">—</span>}</td>
                      <td>{g.classes}</td>
                      <td>{g.matriculados}</td>
                      <td>{f === null ? "—" : <span className={`badge ${tone(f) === "ok" ? "ok" : tone(f) === "bad" ? "bad" : "warn"}`}>{pctTxt(f)}</span>}</td>
                      <td>{tp === null ? "—" : pctTxt(tp)}</td>
                      <td>{g.total.visitantes}</td>
                      <td className="nowrap">{brl(g.total.ofertaCents)}</td>
                      <td>{g.total.pendencias}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Termômetro das classes</h3>
            <p className="muted small">Presença nas 4 últimas aulas validadas comparada às 4 anteriores.</p>
            {thermo.length === 0 ? <Empty>Sem dados.</Empty> : (
              <div className="thermo">
                {thermo.map((c) => (
                  <Link key={c.id} href={`/classes/${c.id}`} className={`thermo-item t-${c.trend}`}>
                    <span className="t-ic" aria-hidden="true">{c.trend === "crescendo" ? "▲" : c.trend === "caindo" ? "▼" : c.trend === "estavel" ? "■" : "·"}</span>
                    <span className="t-nm">{c.name}</span>
                    <span className="t-v">{c.recent ?? "—"}%{c.delta !== null && c.delta !== 0 ? ` (${c.delta > 0 ? "+" : ""}${c.delta})` : ""}</span>
                  </Link>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginTop: ".5rem" }}>
              ▲ crescendo: {thermo.filter((c) => c.trend === "crescendo").length} · ■ estável: {thermo.filter((c) => c.trend === "estavel").length} · ▼ caindo: {thermo.filter((c) => c.trend === "caindo").length}
            </p>
          </div>

          {funnel && funnel.total > 0 && (
            <div className="card">
              <h3>Visitantes no trimestre</h3>
              <Stacked parts={[
                { label: "Matriculados", value: funnel.matriculados, tone: "ok" },
                { label: "Retornaram", value: Math.max(0, funnel.retornaram - funnel.matriculados), tone: "brand" },
                { label: "1ª visita", value: Math.max(0, funnel.total - funnel.retornaram - funnel.perdidos), tone: "warn" },
                { label: "Sem retorno", value: funnel.perdidos, tone: "bad" },
              ]} />
              <p className="small" style={{ marginTop: ".5rem" }}><Link href="/visitantes">Acompanhar visitantes →</Link></p>
            </div>
          )}

          <div className="bi-grid" style={{ marginTop: "1rem" }}>
            <div className="card">
              <h3>Frequência por classe</h3>
              <HBars
                max={100}
                format={pctTxt}
                rows={[...bi.current.classes]
                  .map((c) => ({ label: c.cls.name, value: frequency(c.total), sub: `${c.matriculados} alunos` }))
                  .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
                  .map((r) => ({ ...r, tone: tone(r.value) }))}
              />
            </div>
            <div className="card">
              <h3>Ofertas por classe</h3>
              <HBars
                format={(v) => brl(v)}
                rows={[...bi.current.classes]
                  .map((c) => ({ label: c.cls.name, value: c.total.ofertaCents }))
                  .sort((a, b) => b.value - a.value)}
              />
            </div>
          </div>

          <div className="bi-grid" style={{ marginTop: "1rem" }}>
            <div className="card table-wrap">
              <h3>Professores em destaque</h3>
              <p className="muted small">Assiduidade do professor e presença média da turma nas aulas que ele deu (aulas validadas).</p>
              {ranking.length === 0 ? <Empty>Sem aulas validadas no trimestre.</Empty> : (
                <ol className="ranking">
                  {ranking.slice(0, 12).map((t, i) => (
                    <li key={t.id} className={i < 3 ? "top" : ""}>
                      <span className="pos">{i + 1}</span>
                      <span className="nm">{t.name}<br /><small className="muted">{t.escaladas} aula(s) · turma {t.mediaTurma ?? "—"}%</small></span>
                      <span className="sc">{t.presente}/{t.escaladas}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="card table-wrap">
              <h3>Alunos com frequência abaixo de 50%</h3>
              <p className="muted small">Para acompanhamento e visita (mínimo de 2 aulas validadas).</p>
              {bi.low.length === 0 ? <Empty>Nenhum aluno abaixo de 50%.</Empty> : (
                <table>
                  <thead><tr><th>Aluno</th><th>Classe</th><th>Presenças</th></tr></thead>
                  <tbody>
                    {bi.low.slice(0, 25).map((a) => (
                      <tr key={`${a.id}-${a.class_name}`}>
                        <td>{a.name}</td><td>{a.class_name}</td>
                        <td className="nowrap">{a.presentes}/{a.total} <span className="badge bad">{pctTxt(a.pct)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {bi.low.length > 25 && <p className="muted small">E mais {bi.low.length - 25}. Baixe a frequência completa na Central de relatórios.</p>}
            </div>
          </div>

          <div className="card table-wrap" style={{ marginTop: "1rem" }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Ausentes: faltaram às 3 últimas aulas ({bi.absentees.length})</h3>
              <a className="btn ghost small noprint" href="/relatorio/exportar?tipo=ausentes">CSV</a>
            </div>
            <p className="muted small">Situação atual, com base nas chamadas lançadas. Use para visitar ou mandar uma mensagem.</p>
            {bi.absentees.length === 0 ? <Empty>Nenhum aluno com 3 faltas seguidas.</Empty> : (
              <table>
                <thead><tr><th>Aluno</th><th>Classe</th><th>Última presença</th><th>Contato</th></tr></thead>
                <tbody>
                  {bi.absentees.slice(0, 30).map((a) => (
                    <tr key={`${a.id}-${a.class_id}`}>
                      <td><Link href={`/pessoas/${a.id}`}>{a.name}</Link>{a.guardian_name && <div className="muted small">Resp.: {a.guardian_name}</div>}</td>
                      <td>{a.class_name}</td>
                      <td className="nowrap">{a.lastPresent ? fmtDay(a.lastPresent) : "—"}</td>
                      <td className="nowrap">
                        {a.phone ? <a href={whatsapp(a.phone, a.name)} target="_blank" rel="noopener noreferrer">WhatsApp {a.phone}</a> : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bi-grid" style={{ marginTop: "1rem" }}>
            <div className="card">
              <h3>Escala: próximas 5 semanas sem professor</h3>
              {bi.gaps.length === 0 ? <Empty>Todas as aulas têm professor escalado.</Empty> : (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {bi.gaps.slice(0, 12).map((l) => <li key={l.id}>{fmtDay(l.date)} — {l.class_name}</li>)}
                </ul>
              )}
              {canSeeSomething(user, "schedule", "read") && <p className="small" style={{ marginTop: ".5rem" }}><Link href="/escala">Abrir a escala →</Link></p>}
            </div>
            {bi.finance && (
              <div className="card">
                <h3>Revistas (material didático)</h3>
                <Stacked parts={[
                  { label: "Recebido", value: Math.round(bi.finance.pagoCents / 100), tone: "ok" },
                  { label: "Em aberto", value: Math.round(bi.finance.abertoCents / 100), tone: "warn" },
                ]} />
                <p className="small" style={{ marginTop: ".5rem" }}>
                  {bi.finance.pedidos} revistas · {bi.finance.quitadas} quitadas · total {brl(bi.finance.totalCents)} ·
                  recebido {brl(bi.finance.pagoCents)} · <strong>a receber {brl(bi.finance.abertoCents)}</strong>
                </p>
                <HBars
                  max={100}
                  format={pctTxt}
                  rows={bi.finance.porClasse.map((c) => {
                    const p = c.totalCents ? (c.pagoCents / c.totalCents) * 100 : null;
                    return { label: c.name, value: p, tone: tone(p), sub: "pago" };
                  })}
                />
              </div>
            )}
            <div className="card">
              <h3>Cadastro</h3>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                <li>{bi.people.matriculados} alunos matriculados</li>
                <li>{bi.people.professores} professores · {bi.people.secretarios} secretários de sala</li>
                <li>{bi.current.classes.length} classes em {bi.groups.length} Escala(s)</li>
                <li>{bi.people.birthdaysThisMonth} aniversariante(s) neste mês — <Link href="/aniversariantes">ver</Link></li>
              </ul>
            </div>
          </div>
        </>
      )}

      {tab === "relatorios" && (
        <>
          <p className="muted">Todos os relatórios respeitam o seu nível de acesso. Os arquivos CSV abrem no Excel ou no Google Planilhas.</p>
          <div className="reports-hub">
            <div className="card">
              <h3>Relatório consolidado</h3>
              <p className="small muted">Frequência, professores, visitantes e ofertas por classe e por mês ({quarterLabel(quarter)}).</p>
              <div className="row"><Link className="btn small" href={`/relatorio?t=${key}`}>Abrir</Link><a className="btn ghost small" href={`/relatorio/exportar?t=${key}`}>CSV</a></div>
            </div>
            <div className="card">
              <h3>Relatório em slides</h3>
              <p className="small muted">Apresentação do trimestre para a reunião da EBD ou para o Pastor (tela cheia ou PDF).</p>
              <div className="row"><Link className="btn small" href={`/relatorio/slides?t=${key}`}>▶ Apresentar</Link></div>
            </div>
            <div className="card">
              <h3>Frequência manual</h3>
              <p className="small muted">Lista de chamada em branco por classe, para imprimir e preencher no papel.</p>
              <div className="row"><Link className="btn small" href={`/presenca/folha?t=${key}`}>Imprimir</Link><a className="btn ghost small" href={`/relatorio/exportar?t=${key}&tipo=chamada`}>Excel (CSV)</a></div>
            </div>
            <div className="card">
              <h3>Ausentes</h3>
              <p className="small muted">Alunos que faltaram às 3 últimas aulas, com contato e link de WhatsApp.</p>
              <div className="row"><Link className="btn small" href={href({ aba: "visao" })}>Ver no painel</Link><a className="btn ghost small" href="/relatorio/exportar?tipo=ausentes">CSV</a></div>
            </div>
            <div className="card">
              <h3>Frequência individual</h3>
              <p className="small muted">Presenças de cada aluno e professor no trimestre (somente relatórios validados).</p>
              <div className="row"><a className="btn small" href={`/relatorio/exportar?t=${key}&tipo=frequencia`}>Baixar CSV</a></div>
            </div>
            {canSeeSomething(user, "schedule") && (
              <div className="card">
                <h3>Escala do trimestre</h3>
                <p className="small muted">Folha por Escala no formato da planilha, com o lema “{getSettings().lema}”.</p>
                <div className="row"><Link className="btn small" href={`/escala?t=${key}`}>Abrir</Link><Link className="btn ghost small" href={`/escala/imprimir?t=${key}`}>Imprimir</Link></div>
              </div>
            )}
            {can(user, "update", { type: "report" }) && (
              <div className="card">
                <h3>Validação</h3>
                <p className="small muted">Relatórios das salas aguardando conferência, devolvidos e não enviados.</p>
                <div className="row"><Link className="btn small" href="/validacao">Abrir fila</Link></div>
              </div>
            )}
            {bi.finance && (
              <div className="card">
                <h3>Revistas e pagamentos</h3>
                <p className="small muted">Revista de cada aluno, valor pago e saldo em aberto.</p>
                <div className="row"><Link className="btn small" href="/materiais">Abrir</Link><a className="btn ghost small" href="/relatorio/exportar?tipo=materiais">CSV</a></div>
              </div>
            )}
            <div className="card">
              <h3>Aniversariantes</h3>
              <p className="small muted">Alunos, professores e equipe, mês a mês, com filtro por categoria.</p>
              <div className="row"><Link className="btn small" href="/aniversariantes">Abrir</Link></div>
            </div>
            {canSeeSomething(user, "person") && (
              <div className="card">
                <h3>Cadastro e fichas</h3>
                <p className="small muted">Alunos, professores, coordenadores, secretários e colaboradores, com a ficha individual de cada um.</p>
                <div className="row"><Link className="btn small" href="/pessoas">Abrir</Link></div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "acessos" && canAccess && <AccessTab user={user} />}
    </>
  );
}

function AccessTab({ user }: { user: Parameters<typeof usersByRole>[0] }) {
  const counts = usersByRole(user);
  const matrix = permissionMatrix();
  return (
    <>
      <p className="muted">
        O acesso é decidido por regras (ABAC): a <strong>função</strong> do usuário combinada com os
        <strong> atributos</strong> de cada registro — a classe/Escala, se a pessoa é o professor escalado, se é a
        secretária da sala e a situação do relatório. Tudo o que não está liberado abaixo é negado.
      </p>
      <div className="kpis">
        {ROLES.map((r) => (
          <div className="card" key={r}>
            <div className="muted small">{ROLE_LABEL[r]}</div>
            <div className="stat">{counts[r] ?? 0}</div>
            <div className="muted small">usuário(s)</div>
          </div>
        ))}
      </div>
      <p className="noprint"><Link className="btn small" href="/usuarios">Gerenciar usuários e funções</Link> <Link className="btn ghost small" href="/classes">Designar coordenadores de Escala</Link></p>

      <h2>Matriz de permissões</h2>
      <p className="small">
        <span className="badge ok">verde</span> sempre permitido para a função ·{" "}
        <span className="badge warn">amarelo</span> permitido conforme o contexto (passe o mouse para ver a regra).
        A coluna de cada função também inclui o que a pessoa pode fazer quando for a <strong>secretária da sala</strong>.
      </p>
      <div className="card table-wrap">
        <table className="matrix">
          <thead><tr><th>Recurso</th>{ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {ALL_RESOURCE_TYPES.map((res) => (
              <tr key={res}>
                <th scope="row" style={{ textAlign: "left" }}>{RESOURCE_LABEL[res]}</th>
                {ROLES.map((role) => {
                  const cell = matrix[role][res];
                  return (
                    <td key={role}>
                      {cell.length === 0 ? <span className="muted">—</span> : cell.map((c) => (
                        <span key={c.action} className={`perm ${c.conditional ? "cond" : ""}`} title={c.rules.join("\n")}>
                          {ACTION_LABEL[c.action]}
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Regras principais</h2>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }} className="small">
          <li>Cada sala tem <strong>um</strong> secretário(a), que lança presença, visitantes e oferta e envia o relatório.</li>
          <li>Na ausência do secretário (ou se a sala não tiver um), o <strong>professor escalado</strong> naquele domingo assume.</li>
          <li>A <strong>secretaria geral</strong> valida ou devolve; quem enviou não valida o próprio relatório.</li>
          <li>Relatório validado fica travado; só a <strong>superintendência</strong> reabre.</li>
          <li>O <strong>coordenador</strong> acompanha e organiza a sua Escala (escala, matrículas, equipe), sem preencher relatórios.</li>
          <li>Só a <strong>superintendência</strong> designa coordenadores, cria Escalas/classes e gerencia usuários.</li>
        </ul>
      </div>
    </>
  );
}
