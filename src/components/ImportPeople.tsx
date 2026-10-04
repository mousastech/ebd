"use client";

import { useState, useTransition } from "react";
import { previewImportAction, runImportAction } from "@/app/actions-import";
import type { ImportRow } from "@/lib/importer";

/** Importação em duas etapas: pré-visualizar (conferir erros) e importar. */
export function ImportPeople() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    // planilhas salvas no Excel em português costumam vir em Windows-1252
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
    setText(t);
    setRows(null);
    setMsg(null);
  }

  const preview = () => start(async () => {
    setMsg(null);
    const r = await previewImportAction(text);
    if (r.ok) setRows(r.data);
    else { setRows(null); setMsg({ kind: "erro", text: r.error }); }
  });

  const doImport = () => start(async () => {
    const r = await runImportAction(text);
    if (r.ok) {
      setMsg({ kind: "ok", text: `Importação concluída: ${r.data.criados} cadastrado(s), ${r.data.matriculados} matriculado(s) em nova classe, ${r.data.erros} linha(s) com erro ignorada(s).` });
      setRows(null);
      setText("");
    } else setMsg({ kind: "erro", text: r.error });
  });

  const counts = rows && { novo: rows.filter((r) => r.status === "novo").length, existente: rows.filter((r) => r.status === "existente").length, erro: rows.filter((r) => r.status === "erro").length };

  return (
    <div className="stack">
      <div className="card stack">
        <label className="btn ghost" style={{ textAlign: "center" }}>
          📄 Escolher planilha (.csv)
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} hidden />
        </label>
        <div>
          <label htmlFor="csv">Ou cole aqui (copiado do Excel/Planilhas)</label>
          <textarea id="csv" rows={6} value={text} onChange={(e) => { setText(e.target.value); setRows(null); }} placeholder={"nome;nascimento;telefone;responsável;e-mail;classe"} />
        </div>
        <button type="button" onClick={preview} disabled={!text.trim() || pending}>{pending && !rows ? "Lendo…" : "Pré-visualizar"}</button>
      </div>
      {msg && <div className={`flash ${msg.kind}`} role="status">{msg.text}</div>}
      {rows && counts && (
        <div className="card table-wrap">
          <div className="row between">
            <strong>{counts.novo} novo(s) · {counts.existente} já cadastrado(s) · {counts.erro} com erro</strong>
            <button type="button" onClick={doImport} disabled={pending || counts.novo + counts.existente === 0}>{pending ? "Importando…" : "Importar"}</button>
          </div>
          <table>
            <thead><tr><th>Linha</th><th>Nome</th><th>Nascimento</th><th>Classe</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td><td>{r.name || "—"}</td><td>{r.birth ? r.birth.split("-").reverse().join("/") : "—"}</td><td>{r.className || "—"}</td>
                  <td>{r.status === "erro" ? <span className="badge bad">{r.error}</span> : r.status === "novo" ? <span className="badge ok">novo</span> : <span className="badge">já cadastrado{r.classId ? " · matricular" : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
