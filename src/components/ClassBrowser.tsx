"use client";

import Link from "next/link";
import { useState } from "react";

export type BrowserCard = {
  id: number; name: string; age_range: string | null; students: number; professors: string[];
  secretary: string | null; group_id: number | null; group_name: string | null; coordinator: string | null;
};

/** Lista de turmas com busca, filtro por Escala e ordenação A–Z (padrão de app). */
export function ClassBrowser({ cards, groups }: { cards: BrowserCard[]; groups: { id: number; name: string }[] }) {
  const [q, setQ] = useState("");
  const [g, setG] = useState<number | "all">("all");
  const [asc, setAsc] = useState(true);
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const shown = cards
    .filter((c) => g === "all" || c.group_id === g)
    .filter((c) => !q || norm([c.name, c.age_range ?? "", ...c.professors, c.secretary ?? ""].join(" ")).includes(norm(q)))
    .sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      <div className="search">
        <span aria-hidden="true">⌕</span>
        <input type="search" placeholder="Buscar turma ou professor…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar turma ou professor" />
      </div>
      {groups.length > 1 && (
        <div className="chips" role="tablist" aria-label="Escalas">
          <button type="button" className={g === "all" ? "active" : ""} onClick={() => setG("all")}>Todas</button>
          {groups.map((x) => (
            <button type="button" key={x.id} className={g === x.id ? "active" : ""} onClick={() => setG(x.id)}>{x.name}</button>
          ))}
        </div>
      )}
      <div className="row between small muted" style={{ margin: ".2rem 0 .5rem" }}>
        <span>{shown.length} de {cards.length}</span>
        <button type="button" className="linkish" onClick={() => setAsc((v) => !v)}>{asc ? "A–Z" : "Z–A"} ⇅</button>
      </div>
      <div className="list">
        {shown.map((c) => (
          <Link key={c.id} href={`/classes/${c.id}`} className="list-card class-card">
            <span className="count-badge"><strong>{c.students}</strong><small>alunos</small></span>
            <span className="class-info">
              <strong>{c.name}</strong>
              <span className="small muted">{[c.age_range, c.group_name].filter(Boolean).join(" · ")}</span>
              <span className="small muted">👥 {c.professors.length} prof. · Sec.: {c.secretary ?? "—"}</span>
            </span>
            <span aria-hidden="true" className="chev">›</span>
          </Link>
        ))}
      </div>
    </>
  );
}
