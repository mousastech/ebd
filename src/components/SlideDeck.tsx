"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";

/** Apresentação em tela cheia: setas do teclado, toque (deslizar) e impressão em PDF (um slide por página). */
export function SlideDeck({ children, backHref }: { children: React.ReactNode; backHref: string }) {
  const slides = Children.toArray(children);
  const [i, setI] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(slides.length - 1, x + d))), [slides.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
      if (e.key === "Home") setI(0);
      if (e.key === "End") setI(slides.length - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go, slides.length]);

  let startX = 0;
  return (
    <div
      ref={root}
      className="deck"
      onTouchStart={(e) => { startX = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}
    >
      <div className="deck-bar noprint">
        <a href={backHref} className="btn ghost small">← Sair</a>
        <span className="small">{i + 1} / {slides.length}</span>
        <span className="row">
          <button type="button" className="ghost small" onClick={() => root.current?.requestFullscreen?.()}>Tela cheia</button>
          <button type="button" className="ghost small" onClick={() => window.print()}>PDF</button>
        </span>
      </div>
      {slides.map((s, k) => (
        <div key={k} className={`slide ${k === i ? "on" : ""}`} aria-hidden={k !== i}>{s}</div>
      ))}
      <button type="button" className="deck-nav prev noprint" onClick={() => go(-1)} aria-label="Slide anterior" disabled={i === 0}>‹</button>
      <button type="button" className="deck-nav next noprint" onClick={() => go(1)} aria-label="Próximo slide" disabled={i === slides.length - 1}>›</button>
    </div>
  );
}
