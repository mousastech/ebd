import type { MetadataRoute } from "next";

/** Torna o sistema instalável como aplicativo (PWA) no celular e no computador. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EBD — Escola Bíblica Dominical",
    short_name: "EBD",
    description: "Chamada, escala, relatórios e revistas da Escola Bíblica Dominical.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#1f5c57",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Chamada", url: "/presenca" },
      { name: "Escala", url: "/escala" },
      { name: "Painel", url: "/admin" },
    ],
  };
}
