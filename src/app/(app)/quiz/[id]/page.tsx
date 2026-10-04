import Link from "next/link";
import { answerQuizAction } from "@/app/actions-ensino";
import { requireUser } from "@/lib/auth";
import { guarded, type Flash } from "@/lib/guard";
import { getQuiz } from "@/lib/quiz";
import { FlashMessage } from "@/components/ui";

export default async function QuizDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const z = guarded(() => getQuiz(user, Number(id)));
  const L = (i: number) => String.fromCharCode(65 + i);

  return (
    <>
      <div className="pagehead">
        <Link href="/quiz" className="back" aria-label="Voltar">←</Link>
        <div><h1>{z.quiz.title}</h1><p className="muted small">{z.quiz.class_name} · {z.questions.length} pergunta(s){z.quiz.open ? "" : " · encerrado"}</p></div>
      </div>
      <FlashMessage flash={sp} />
      {z.attempt && (
        <section className="hero"><div className="hero-eyebrow">Seu resultado</div>
          <div className="hero-main"><span className="hero-value">{z.attempt.score}/{z.attempt.total}</span><span className="hero-caption">acertos</span></div>
        </section>
      )}

      {z.canAnswer ? (
        <form action={answerQuizAction} className="stack">
          <input type="hidden" name="id" value={z.quiz.id} />
          {z.questions.map((q, i) => (
            <fieldset key={q.id} className="card qbox">
              <legend><strong>{i + 1}.</strong> {q.text}</legend>
              <div className="stack">
                {q.options.map((o, k) => (
                  <label key={k} className="check quiz-opt"><input type="radio" name={`a${i + 1}`} value={k} required /> <b>{L(k)})</b> {o}</label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="savebar"><button type="submit" className="block">Enviar respostas</button></div>
        </form>
      ) : (
        <div className="stack">
          {z.questions.map((q, i) => (
            <div key={q.id} className="card">
              <strong>{i + 1}. {q.text}</strong>
              <ul className="quiz-review">
                {q.options.map((o, k) => {
                  const mine = z.attempt?.answers[i] === k;
                  const right = q.correct === k;
                  return <li key={k} className={right ? "right" : mine ? "wrong" : ""}>{L(k)}) {o} {right ? "✓" : mine ? "✕" : ""}</li>;
                })}
              </ul>
            </div>
          ))}
          {!z.attempt && !z.canEdit && <p className="muted">Somente os alunos da classe respondem a este quiz.</p>}
        </div>
      )}

      {z.results && (
        <div className="card table-wrap">
          <h3>Respostas da turma ({z.results.length})</h3>
          {z.results.length === 0 ? <p className="muted">Ninguém respondeu ainda.</p> : (
            <table><tbody>{z.results.map((r) => <tr key={r.name}><td>{r.name}</td><td className="right">{r.score}/{r.total}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </>
  );
}
