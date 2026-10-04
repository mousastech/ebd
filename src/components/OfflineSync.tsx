"use client";

import { useCallback, useEffect, useState } from "react";
import { QUEUE_EVENT, readQueue, writeQueue } from "@/lib/offline-queue";

/**
 * Barra de status do modo sem internet: avisa quando o aparelho está offline, mostra quantas chamadas
 * aguardam envio e as envia sozinha quando a conexão volta (só as do usuário logado).
 */
export function OfflineSync({ userId }: { userId: number }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => setPending(readQueue().filter((q) => q.userId === userId).length), [userId]);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    const all = readQueue();
    const mine = all.filter((q) => q.userId === userId);
    if (mine.length === 0) return;
    let sent = 0;
    const errors: string[] = [];
    const keep = all.filter((q) => q.userId !== userId);
    for (const q of mine) {
      try {
        const r = await fetch("/api/chamada", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lessonId: q.lessonId, present: q.present, visitors: q.visitors, offering: q.offering }),
        });
        if (r.ok) sent++;
        else if (r.status === 401) keep.push(q); // precisa logar de novo: mantém
        else errors.push(`${q.label}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? "erro"}`);
      } catch {
        keep.push(q); // caiu a conexão no meio: tenta depois
      }
    }
    writeQueue(keep);
    if (sent) setMsg(`✓ ${sent} chamada(s) feita(s) sem internet foram enviadas.`);
    if (errors.length) setMsg(`Não foi possível enviar: ${errors.join("; ")}`);
  }, [userId]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    void flush();
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener(QUEUE_EVENT, refresh);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener(QUEUE_EVENT, refresh);
    };
  }, [flush, refresh]);

  if (online && pending === 0 && !msg) return null;
  return (
    <div className={`offline-bar ${online ? "" : "is-off"}`} role="status">
      {!online && <span>📴 Sem internet — você pode fazer a chamada; ela fica guardada no aparelho.</span>}
      {online && pending > 0 && <span>⏳ {pending} chamada(s) aguardando envio… <button className="linkish" onClick={() => void flush()}>enviar agora</button></span>}
      {!online && pending > 0 && <span> {pending} aguardando envio.</span>}
      {msg && <span>{msg} <button className="linkish" onClick={() => setMsg(null)} aria-label="Fechar">✕</button></span>}
    </div>
  );
}

/** Baixa as telas de chamada do domingo para abrir sem internet. */
export function PrepareOffline({ urls }: { urls: string[] }) {
  const [state, setState] = useState<"idle" | "ok" | "no">("idle");
  async function go() {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg?.active) return setState("no");
    reg.active.postMessage({ type: "prefetch", urls: ["/presenca", ...urls] });
    setState("ok");
  }
  return (
    <button type="button" className="ghost small" onClick={go}>
      {state === "ok" ? "✓ Pronto para usar sem internet" : state === "no" ? "Instale o app para usar sem internet" : "📥 Preparar para usar sem internet"}
    </button>
  );
}

/** No login: apaga as telas guardadas da conta anterior. */
export function ClearOfflinePages() {
  useEffect(() => {
    navigator.serviceWorker?.getRegistration().then((r) => r?.active?.postMessage("logout")).catch(() => {});
  }, []);
  return null;
}
