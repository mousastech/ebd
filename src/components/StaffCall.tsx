"use client";

import { useState } from "react";
import { Avatar } from "./app-ui";

type P = { id: number; name: string; photo: string | null; roles: string[]; present: boolean | null };
type Mark = "p" | "f" | null;

/** Chamada da equipe no padrão de app: ✓/✕ por pessoa, contadores e salvar fixo. */
export function StaffCall({ people, disabled }: { people: P[]; disabled: boolean }) {
  const [marks, setMarks] = useState<Record<number, Mark>>(
    Object.fromEntries(people.map((p) => [p.id, p.present === null ? null : p.present ? "p" : "f"])),
  );
  const presentes = people.filter((p) => marks[p.id] === "p").length;
  const ausentes = people.filter((p) => marks[p.id] === "f").length;
  const pct = people.length ? Math.round((presentes / people.length) * 100) : 0;
  return (
    <>
      <section className="hero">
        <div className="hero-eyebrow">Presença da equipe</div>
        <div className="hero-main"><span className="hero-value">{pct}%</span><span className="hero-caption">presença geral</span></div>
        <div className="hero-stats">
          <div><strong>{presentes}/{people.length}</strong><span>Presentes</span></div>
          <div><strong>{ausentes}</strong><span>Ausentes</span></div>
          <div><strong>{people.length - presentes - ausentes}</strong><span>Pendentes</span></div>
        </div>
      </section>
      {!disabled && (
        <div className="row" style={{ marginBottom: ".6rem" }}>
          <button type="button" className="ghost small" onClick={() => setMarks(Object.fromEntries(people.map((p) => [p.id, "p"])))}>Todos presentes</button>
          <button type="button" className="ghost small" onClick={() => setMarks(Object.fromEntries(people.map((p) => [p.id, null])))}>Limpar</button>
        </div>
      )}
      <div className="atts">
        {people.map((p) => {
          const m = marks[p.id];
          return (
            <div key={p.id} className={`att ${m === "p" ? "is-p" : m === "f" ? "is-f" : ""}`}>
              <Avatar name={p.name} photo={p.photo} />
              <div className="att-who">
                <strong>{p.name}</strong>
                <span className="att-state">{m === "p" ? "Presente" : m === "f" ? "Ausente" : "Aguardando"} · {p.roles.join(" · ")}</span>
              </div>
              <label className="att-btn ok" title="Presente">
                <input type="radio" name={`p_${p.id}`} value="1" checked={m === "p"} disabled={disabled} onChange={() => setMarks((c) => ({ ...c, [p.id]: "p" }))} />
                <span aria-hidden="true">✓</span><span className="sr">Presente</span>
              </label>
              <label className="att-btn bad" title="Ausente">
                <input type="radio" name={`p_${p.id}`} value="0" checked={m === "f"} disabled={disabled} onChange={() => setMarks((c) => ({ ...c, [p.id]: "f" }))} />
                <span aria-hidden="true">✕</span><span className="sr">Ausente</span>
              </label>
            </div>
          );
        })}
      </div>
      {!disabled && (
        <div className="savebar"><button type="submit" className="block">✓ Salvar presença</button></div>
      )}
    </>
  );
}
