"use client";

import { useEffect, useState } from "react";

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Botão para ativar/desativar as notificações no celular ou computador (Web Push). */
export function EnablePush() {
  const [state, setState] = useState<"carregando" | "indisponivel" | "negado" | "ativo" | "inativo">("carregando");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("indisponivel");
      if (Notification.permission === "denied") return setState("negado");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "ativo" : "inativo");
    })().catch(() => setState("indisponivel"));
  }, []);

  async function enable() {
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("negado");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
      if (!r.ok) throw new Error();
      setState("ativo");
      setMsg("Pronto! Você vai receber os avisos neste aparelho.");
    } catch {
      setMsg("Não foi possível ativar aqui. No iPhone, instale o app na tela de início primeiro.");
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("inativo");
    setMsg("Notificações desativadas neste aparelho.");
  }

  if (state === "carregando") return null;
  return (
    <div className="card row between">
      <span>
        <strong>🔔 Notificações no aparelho</strong>
        <br />
        <span className="small muted">
          {state === "ativo" ? "Ativadas neste aparelho." : state === "negado" ? "Bloqueadas nas configurações do navegador." :
            state === "indisponivel" ? "Este navegador não recebe notificações (no iPhone, instale o app na tela de início)." :
            "Receba comunicados, eventos e lembretes mesmo com o app fechado."}
        </span>
        {msg && <><br /><span className="small">{msg}</span></>}
      </span>
      {state === "inativo" && <button type="button" onClick={enable}>Ativar</button>}
      {state === "ativo" && <button type="button" className="ghost small" onClick={disable}>Desativar</button>}
    </div>
  );
}
