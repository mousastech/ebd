"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string };

/** Ícones simples (traço), para a barra inferior no celular. */
const ICONS: Record<string, string> = {
  "/": "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "/admin": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/classes": "M4 6h16M4 12h16M4 18h10",
  "/presenca": "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  "/escala": "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  "/diario": "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  "/validacao": "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM8.5 12l2.5 2.5 4.5-5",
  "/relatorio": "M6 3h9l4 4v14H6zM9 13h6M9 17h6M9 9h3",
  "/aniversariantes": "M4 21h16M5 21v-8h14v8M12 13V9M12 6a1.5 1.5 0 0 0 0-3 1.5 1.5 0 0 0 0 3zM5 17c2 1.5 4-1.5 7 0s5-1.5 7 0",
  "/materiais": "M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6",
  "/pessoas": "M16 20v-2a4 4 0 0 0-8 0v2M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4",
  "/usuarios": "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM12 11v4M12 8h.01",
  "/mural": "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  "/agenda": "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h3v3H8z",
  "/comunicados": "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12",
  "/visitantes": "M15 19v-1a4 4 0 0 0-8 0v1M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 8v6M16 11h6",
  "/financeiro": "M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6",
  "/colaboradores": "M9 11l2 2 4-4M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  "/congregacoes": "M12 2l3 4h-6zM6 22V10l6-4 6 4v12M10 22v-5h4v5",
  "/configuracoes": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.more} />
    </svg>
  );
}

const SHORT: Record<string, string> = { "/presenca": "Chamada", "/admin": "Painel", "/aniversariantes": "Aniversários", "/materiais": "Revistas" };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Itens que vão na barra inferior do celular, na ordem de prioridade (os demais ficam em "Mais"). */
const PRIMARY = ["/", "/presenca", "/escala", "/admin", "/mural", "/agenda", "/aniversariantes", "/materiais"];

export function NavLinks({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Barra de abas inferior (somente no celular), no padrão de aplicativo. */
export function BottomBar({
  items,
  userName,
  roleLabel,
  logout,
}: {
  items: Item[];
  userName: string;
  roleLabel: string;
  logout: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const primary = PRIMARY.map((h) => items.find((i) => i.href === h)).filter(Boolean).slice(0, 4) as Item[];
  const rest = items.filter((i) => !primary.includes(i));
  const restActive = rest.some((i) => isActive(path, i.href));

  return (
    <>
      {open && <div className="sheet-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="sheet" role="dialog" aria-label="Mais opções">
          <div className="sheet-me">
            <strong>{userName}</strong>
            <span className="muted small">{roleLabel}</span>
          </div>
          <div className="sheet-grid">
            {rest.map((i) => (
              <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? "page" : undefined}>
                <Icon name={i.href} />
                <span>{i.label}</span>
              </Link>
            ))}
          </div>
          <form action={logout}>
            <button type="submit" className="ghost" style={{ width: "100%" }}>Sair</button>
          </form>
        </div>
      )}
      <nav className="tabbar" aria-label="Navegação principal">
        {primary.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? "page" : undefined}>
            <Icon name={i.href} />
            <span>{SHORT[i.href] ?? i.label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-current={restActive ? "page" : undefined}>
          <Icon name="more" />
          <span>Mais</span>
        </button>
      </nav>
    </>
  );
}
