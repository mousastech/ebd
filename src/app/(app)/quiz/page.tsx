import Link from "next/link";
import { createQuizAction, deleteQuizAction } from "@/app/actions-ensino";
import { can, canSeeSomething, ForbiddenError } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { fmtDate, parseQuarter, quarterLabel, todayISO } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { classScores, listQuizzes, POINTS } from "@/lib/quiz";
import { listClasses } from "@/lib/repo";
import { Avatar } from "@/components/app-ui";
import { Empty, FlashMessage } from "@/components/ui";

export default async function QuizPage({ searchParams }: { searchParams: Promise<Flash & { classe?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  guarded(() => { if (!canSeeSomething(user, "quiz")) throw new ForbiddenError(); });
  const quizzes = listQuizzes(user);
  const classes = listClasses(user).filter((c) => can(user, "read", { type: "quiz", classIds: [c.id] }));
  const createClasses = classes.filter((c) => can(user, "create", { type: "quiz", classIds: [c.id] }));
  const q = parseQuarter(undefined);
  const rankClass = classes.find((c) => c.id === Number(sp.classe)) ?? classes.find((c) => user.enrolled.includes(c.id)) ?? classes[0];
  const scores = rankClass ? classScores(user, rankClass.id, q) : [];
  const isStudent = user.enrolled.length > 0;

  return (
    <>
      <div className="pagehead"><div><h1>Quiz e pontuação</h1><p className="muted small">{POINTS.presenca} pontos por presença · {POINTS.acerto} por acerto no quiz</p></div></div>
      <FlashMessage flash={sp} />

      {createClasses.length > 0 && (
        <details className="card">
          <summary><strong>＋ Novo quiz</strong></summary>
          <form action={createQuizAction} className="stack" style={{ marginTop: ".6rem" }}>
            <div className="form-grid">
              <div><label htmlFor="qc">Classe</label><select id="qc" name="class_id">{createClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label htmlFor="qt">Título</label><input id="qt" name="title" required placeholder="ex.: Lição 3 — A Aliança" /></div>
              <div><label htmlFor="qu">Aberto até</label><input id="qu" name="open_until" type="date" /></div>
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <fieldset key={i} className="qbox">
                <legend>Pergunta {i}{i > 1 ? " (opcional)" : ""}</legend>
                <input name={`q${i}`} placeholder="Enunciado" required={i === 1} aria-label={`Pergunta ${i}`} />
                <div className="form-grid" style={{ marginTop: ".4rem" }}>
                  {[1, 2, 3, 4].map((k) => (
                    <label key={k} className="check opt">
                      <input type="radio" name={`q${i}c`} value={k} defaultChecked={k === 1} aria-label={`Alternativa ${k} é a correta`} />
                      <input name={`q${i}o${k}`} placeholder={`Alternativa ${String.fromCharCode(64 + k)}${k > 2 ? " (opcional)" : ""}`} aria-label={`Alternativa ${k}`} />
                    </label>
                  ))}
                </div>
                <small className="muted">Marque a bolinha da alternativa correta.</small>
              </fieldset>
            ))}
            <button type="submit">Publicar quiz</button>
          </form>
        </details>
      )}

      <h3 className="section-label">Quizzes</h3>
      {quizzes.length === 0 ? <Empty>Nenhum quiz por enquanto.</Empty> : (
        <div className="list">
          {quizzes.map((z) => (
            <div key={z.id} className="list-card">
              <div className="row between" style={{ flexWrap: "nowrap" }}>
                <Link href={`/quiz/${z.id}`}><strong>{z.title}</strong></Link>
                {z.myScore !== null ? <span className="chip ok"><i />{z.myScore}/{z.questions}</span> :
                  z.canAnswer ? <span className="chip brand"><i />Responder</span> : !z.open ? <span className="chip"><i />Encerrado</span> : null}
              </div>
              <div className="small muted">{z.class_name} · {z.questions} pergunta(s){z.open_until ? ` · até ${fmtDate(z.open_until)}` : ""}{z.canEdit ? ` · ${z.attempts} resposta(s)` : ""}</div>
              <div className="row" style={{ marginTop: ".4rem" }}>
                <Link className="btn small" href={`/quiz/${z.id}`}>{z.canAnswer ? "Responder" : z.canEdit ? "Ver resultados" : "Ver"}</Link>
                {z.canEdit && <form action={deleteQuizAction}><input type="hidden" name="id" value={z.id} /><button className="danger small" type="submit">Excluir</button></form>}
              </div>
            </div>
          ))}
        </div>
      )}

      {rankClass && (
        <>
          <h3 className="section-label">Pontuação — {quarterLabel(q)}</h3>
          {classes.length > 1 && (
            <nav className="chips">{classes.map((c) => <Link key={c.id} href={`/quiz?classe=${c.id}`} className={c.id === rankClass.id ? "active" : ""}>{c.name}</Link>)}</nav>
          )}
          <div className="card">
            {scores.length === 0 ? <Empty>Sem alunos.</Empty> : (
              <ol className="ranking">
                {scores.slice(0, isStudent && !can(user, "update", { type: "quiz", classIds: [rankClass.id] }) ? 10 : 100).map((s, i) => (
                  <li key={s.id} className={`${i < 3 ? "top" : ""} ${s.id === user.personId ? "me" : ""}`}>
                    <span className="pos">{i + 1}</span>
                    <Avatar name={s.name} photo={s.photo} />
                    <span className="nm">{s.name}<br /><small className="muted">{s.presencas} presença(s) · {s.acertos} acerto(s)</small></span>
                    <span className="sc"><strong>{s.pontos}</strong> pts</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="small muted">Presenças contam após a validação do relatório da aula. Atualizado em {fmtDate(todayISO())}.</p>
        </>
      )}
    </>
  );
}
