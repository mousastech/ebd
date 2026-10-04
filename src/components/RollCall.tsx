"use client";

import { useMemo, useState } from "react";
import { enqueue } from "@/lib/offline-queue";
import { Avatar } from "./app-ui";

type P = { id: number; name: string; present: boolean; marked: boolean };
type Mark = "p" | "f" | null;

/**
 * Chamada no estilo aplicativo: cada pessoa tem ✓ (presente) e ✕ (falta); sem marcação = "Aguardando".
 * São botões de rádio comuns (campo p_<id>), então o formulário funciona mesmo sem JavaScript.
 */
export function RollCall({
  teachers,
  students,
  disabled,
  submitLabel,
  counts,
  offline,
}: {
  teachers: P[];
  students: P[];
  disabled: boolean;
  submitLabel: string;
  counts: { visitors: number; offering: string; editable: boolean } | null;
  /** dados para guardar a chamada no aparelho quando estiver sem internet */
  offline?: { userId: number; lessonId: number; label: string };
}) {
  const [savedOffline, setSavedOffline] = useState(false);
  const everyone = [...teachers, ...students];
  const [marks, setMarks] = useState<Record<number, Mark>>(
    Object.fromEntries(everyone.map((p) => [p.id, p.marked ? (p.present ? "p" : "f") : null])),
  );
  const [visitors, setVisitors] = useState(String(counts?.visitors ?? 0));
  const [offering, setOffering] = useState(counts?.offering ?? "0,00");
  const presentes = students.filter((s) => marks[s.id] === "p").length;
  const pendentes = everyone.filter((p) => marks[p.id] === null).length;
  const pct = students.length ? Math.round((presentes / students.length) * 100) : 0;
  const bulk = (m: Mark) => setMarks((cur) => ({ ...cur, ...Object.fromEntries(students.map((s) => [s.id, m])) }));
  const sorted = useMemo(() => [...students].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [students]);

  const row = (p: P) => {
    const m = marks[p.id];
    return (
      <div key={p.id} className={`att ${m === "p" ? "is-p" : m === "f" ? "is-f" : ""}`}>
        <Avatar name={p.name} />
        <div className="att-who">
          <strong>{p.name}</strong>
          <span className="att-state">{m === "p" ? "Presente" : m === "f" ? "Falta" : "Aguardando"}</span>
        </div>
        <label className="att-btn ok" title="Presente">
          <input type="radio" name={`p_${p.id}`} value="1" checked={m === "p"} disabled={disabled}
            onChange={() => setMarks((c) => ({ ...c, [p.id]: "p" }))} />
          <span aria-hidden="true">✓</span><span className="sr">Presente</span>
        </label>
        <label className="att-btn bad" title="Falta">
          <input type="radio" name={`p_${p.id}`} value="0" checked={m === "f"} disabled={disabled}
            onChange={() => setMarks((c) => ({ ...c, [p.id]: "f" }))} />
          <span aria-hidden="true">✕</span><span className="sr">Falta</span>
        </label>
      </div>
    );
  };

  return (
    <>
      <div className="att-top">
        <div><strong className="big">{presentes}</strong> / {students.length} presentes · {pct}%</div>
        <div className="progress"><span className="tone-brand" style={{ width: `${pct}%` }} /></div>
      </div>


      {counts && (
        <div className="card counts">
          <div>
            <label htmlFor="vis">Visitantes</label>
            <input id="vis" name="visitors" type="number" min={0} inputMode="numeric" value={visitors}
              onChange={(e) => setVisitors(e.target.value)} disabled={!counts.editable} />
          </div>
          <div>
            <label htmlFor="off">Oferta (R$)</label>
            <input id="off" name="offering" inputMode="decimal" value={offering}
              onChange={(e) => setOffering(e.target.value)} disabled={!counts.editable} />
          </div>
        </div>
      )}

      {!disabled && students.length > 0 && (
        <details className="card bulk">
          <summary><strong>Ações em massa</strong><span className="muted small">Marcar todos de uma vez</span></summary>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <button type="button" className="ghost small" onClick={() => bulk("p")}>Todos presentes</button>
            <button type="button" className="ghost small" onClick={() => bulk("f")}>Todos com falta</button>
            <button type="button" className="ghost small" onClick={() => bulk(null)}>Limpar</button>
          </div>
        </details>
      )}

      {teachers.length > 0 && (
        <>
          <h3 className="section-label">Professor da aula</h3>
          <div className="atts">{teachers.map(row)}</div>
        </>
      )}

      <h3 className="section-label">Alunos da turma · {students.length}</h3>
      {students.length === 0 ? <p className="muted">Nenhum aluno matriculado nesta classe.</p> : <div className="atts">{sorted.map(row)}</div>}

      {savedOffline && (
        <div className="note" role="status">📴 Sem internet: a chamada ficou <strong>guardada neste aparelho</strong> e será enviada sozinha quando a conexão voltar. Não feche a conta até lá.</div>
      )}
      {!disabled && (
        <div className="savebar">
          {pendentes > 0 && <span className="small muted">{pendentes} sem marcação contam como falta</span>}
          <button
            type="submit"
            className="block"
            onClick={(e) => {
              if (!offline || navigator.onLine) return; // com internet: envio normal do formulário
              e.preventDefault();
              enqueue({
                userId: offline.userId, lessonId: offline.lessonId, label: offline.label,
                present: everyone.filter((p) => marks[p.id] === "p").map((p) => p.id),
                ...(counts?.editable ? { visitors, offering } : {}),
                savedAt: new Date().toISOString(),
              });
              setSavedOffline(true);
            }}
          >✓ {submitLabel}</button>
        </div>
      )}
    </>
  );
}
